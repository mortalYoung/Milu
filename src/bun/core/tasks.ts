import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TaskStatus } from "../../shared/events";
import type { TaskSummary } from "../../shared/rpc";
import type { SandboxMode } from "../permission";
import type { RunningProcess, TaskExecutionEnv } from "../tools/execution-env";

export type { TaskStatus, TaskSummary };

/** A task read back from the session log: no process, but its log file is still on disk. */
export interface TaskHistoryRecord {
	id: string;
	command: string;
	logPath: string;
	startedAt: number;
	status: TaskStatus;
	exitCode?: number;
	signalCode?: string;
	endedAt?: number;
}

export interface TaskRead {
	ok: true;
	text: string;
	nextOffset: number;
	startOffset: number;
	hasMore: boolean;
	eof: boolean;
	reset: boolean;
	truncated: boolean;
	status: TaskStatus;
	exitCode?: number;
	bytes: number;
}

export interface TaskFailure {
	ok: false;
	error: string;
}

export type TaskReadResult = TaskRead | TaskFailure;

export interface TaskSubscribeResult {
	ok: true;
	exited: boolean;
	exitCode?: number;
	remindAfter: number;
}

export interface TaskRegistryDeps {
	dirFor(partner: string): string;
	loadHistory(partner: string): Promise<TaskHistoryRecord[]>;
	onStart(task: TaskSummary & { partner: string; logPath: string }): void | Promise<void>;
	onEnd(task: TaskSummary & { partner: string }): void | Promise<void>;
	onChange(taskId: string, partner: string, kind: "started" | "output" | "ended"): void;
	notify(partner: string, taskId: string, reason: "exit" | "deadline", remindAfter?: number): void;
}

export interface StartInput {
	partner: string;
	command: string;
	env: TaskExecutionEnv;
	cwd?: string;
	sandboxMode?: SandboxMode;
}

const PUSH_MIN_MS = 120;
const MAX_READ_BYTES = 50 * 1024;
const DEFAULT_LINES = 200;
export const DEFAULT_REMIND_AFTER_SEC = 180;

interface TaskRecord {
	id: string;
	partner: string;
	command: string;
	logPath: string;
	pid: number;
	status: TaskStatus;
	exitCode?: number;
	signalCode?: string;
	startedAt: number;
	endedAt?: number;
	bytes: number;
	proc: RunningProcess;
	queue: Promise<void>;
	stopping: boolean;
	exitSubscribed: boolean;
	deadline: ReturnType<typeof setTimeout> | null;
	pushTimer: ReturnType<typeof setTimeout> | null;
	lastPushAt: number;
}

interface ReadTarget {
	logPath: string;
	status: TaskStatus;
	exitCode?: number;
	pending: Promise<void>;
}

function summary(task: TaskRecord): TaskSummary {
	return {
		id: task.id,
		command: task.command,
		status: task.status,
		pid: task.pid,
		...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}),
		...(task.signalCode !== undefined ? { signalCode: task.signalCode } : {}),
		startedAt: task.startedAt,
		...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
		bytes: task.bytes,
	};
}

function fromHistory(record: TaskHistoryRecord): TaskSummary {
	return {
		id: record.id,
		command: record.command,
		status: record.status,
		...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
		...(record.signalCode !== undefined ? { signalCode: record.signalCode } : {}),
		startedAt: record.startedAt,
		...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
		bytes: 0,
	};
}

async function fileSize(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

export function createTaskRegistry(deps: TaskRegistryDeps) {
	const tasks = new Map<string, TaskRecord>();
	const past = new Map<string, Map<string, TaskHistoryRecord>>();
	const pastById = new Map<string, TaskHistoryRecord>();
	let seq = 0;

	async function ensureHistory(partner: string): Promise<void> {
		if (past.has(partner)) return;
		const records = await deps.loadHistory(partner).catch(() => [] as TaskHistoryRecord[]);
		past.set(partner, new Map(records.map((record) => [record.id, record])));
		for (const record of records) pastById.set(record.id, record);
	}

	function push(task: TaskRecord, kind: "started" | "output" | "ended"): void {
		deps.onChange(task.id, task.partner, kind);
	}

	function scheduleOutput(task: TaskRecord): void {
		const elapsed = Date.now() - task.lastPushAt;
		if (elapsed >= PUSH_MIN_MS) {
			task.lastPushAt = Date.now();
			push(task, "output");
			return;
		}
		if (task.pushTimer) return;
		task.pushTimer = setTimeout(() => {
			task.pushTimer = null;
			task.lastPushAt = Date.now();
			push(task, "output");
		}, PUSH_MIN_MS - elapsed);
	}

	function append(task: TaskRecord, chunk: string): void {
		task.bytes += Buffer.byteLength(chunk);
		task.queue = task.queue.then(() => appendFile(task.logPath, chunk)).catch(() => {});
		scheduleOutput(task);
	}

	function clearDeadline(task: TaskRecord): void {
		if (task.deadline) clearTimeout(task.deadline);
		task.deadline = null;
	}

	function settle(task: TaskRecord): void {
		clearDeadline(task);
		if (task.pushTimer) clearTimeout(task.pushTimer);
		task.pushTimer = null;
		const code = task.proc.exitCode;
		task.exitCode = code ?? undefined;
		task.signalCode = task.proc.signalCode ?? undefined;
		task.status = task.stopping ? "killed" : "exited";
		task.endedAt = Date.now();
		void task.queue.then(() => Promise.resolve(deps.onEnd({ ...summary(task), partner: task.partner })).catch(() => {}));
		if (task.exitSubscribed) {
			task.exitSubscribed = false;
			deps.notify(task.partner, task.id, "exit");
		}
		past.delete(task.partner);
		push(task, "ended");
	}

	async function start(input: StartInput): Promise<{ ok: true; task: TaskSummary } | TaskFailure> {
		const id = `task-${Date.now().toString(36)}-${++seq}`;
		const dir = join(deps.dirFor(input.partner), "tasks");
		const logPath = join(dir, `${id}.log`);
		try {
			await mkdir(dir, { recursive: true });
			await appendFile(logPath, "");
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
		const record: TaskRecord = {
			id,
			partner: input.partner,
			command: input.command,
			logPath,
			pid: 0,
			status: "running",
			startedAt: Date.now(),
			bytes: 0,
			proc: null as unknown as RunningProcess,
			queue: Promise.resolve(),
			stopping: false,
			exitSubscribed: false,
			deadline: null,
			pushTimer: null,
			lastPushAt: 0,
		};
		const started = await input.env.start(input.command, {
			cwd: input.cwd,
			sandboxMode: input.sandboxMode,
			onStdout: (chunk) => append(record, chunk),
			onStderr: (chunk) => append(record, chunk),
		});
		if (!started.ok) return { ok: false, error: started.error.message };
		record.proc = started.value;
		record.pid = started.value.pid;
		tasks.set(id, record);
		past.delete(input.partner);
		await Promise.resolve(deps.onStart({ ...summary(record), partner: input.partner, logPath })).catch(() => {});
		void started.value.exited.then(() => settle(record));
		push(record, "started");
		return { ok: true, task: summary(record) };
	}

	function get(id: string): TaskSummary | undefined {
		const live = tasks.get(id);
		if (live) return summary(live);
		const historic = pastById.get(id);
		return historic ? fromHistory(historic) : undefined;
	}

	async function list(partner: string): Promise<TaskSummary[]> {
		await ensureHistory(partner);
		const historic = [...(past.get(partner)?.values() ?? [])].filter((record) => !tasks.has(record.id)).map(fromHistory);
		const live = [...tasks.values()].filter((task) => task.partner === partner).map(summary);
		return [...live, ...historic].sort((a, b) => b.startedAt - a.startedAt);
	}

	/** Every live task on this machine, with the chat it belongs to — the welcome screen's list. */
	function listRunning(): { partner: string; task: TaskSummary }[] {
		return [...tasks.values()]
			.filter((task) => task.status === "running")
			.map((task) => ({ partner: task.partner, task: summary(task) }))
			.sort((a, b) => b.task.startedAt - a.task.startedAt);
	}

	async function target(id: string): Promise<ReadTarget | null> {
		const live = tasks.get(id);
		if (live) return { logPath: live.logPath, status: live.status, exitCode: live.exitCode, pending: live.queue };
		const historic = pastById.get(id);
		if (historic) return { logPath: historic.logPath, status: historic.status, exitCode: historic.exitCode, pending: Promise.resolve() };
		return null;
	}

	async function read(id: string, options: { offset?: number; before?: number; lines?: number; partner?: string } = {}): Promise<TaskReadResult> {
		if (options.partner) await ensureHistory(options.partner);
		const found = await target(id);
		if (!found) return { ok: false, error: `unknown task ${id}` };
		await found.pending;
		const size = await fileSize(found.logPath);
		const lines = options.lines && options.lines > 0 ? options.lines : DEFAULT_LINES;
		const offset = options.offset;
		let reset = false;
		let start = offset ?? Math.max(0, size - MAX_READ_BYTES);
		if (offset !== undefined && offset > size) {
			reset = true;
			start = 0;
		}
		const end = options.before !== undefined ? Math.max(0, Math.min(options.before, size)) : Math.min(size, start + MAX_READ_BYTES);
		const from = options.before !== undefined ? Math.max(0, end - MAX_READ_BYTES) : start;
		let handle: Awaited<ReturnType<typeof open>>;
		try {
			handle = await open(found.logPath, "r");
		} catch {
			return {
				ok: true,
				text: "",
				nextOffset: size,
				startOffset: 0,
				hasMore: false,
				eof: true,
				reset,
				truncated: false,
				status: found.status,
				exitCode: found.exitCode,
				bytes: size,
			};
		}
		try {
			const buffer = Buffer.alloc(Math.max(0, end - from));
			if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, from);
			const raw = buffer.toString("utf8");

			// ——— backwards: whole lines only, so a prepend never duplicates or loses bytes ———
			if (options.before !== undefined) {
				let base = from;
				let body = raw;
				if (base > 0) {
					const newline = body.indexOf("\n");
					if (newline < 0) {
						return {
							ok: true,
							text: "",
							nextOffset: base,
							startOffset: base,
							hasMore: false,
							eof: false,
							reset: false,
							truncated: true,
							status: found.status,
							exitCode: found.exitCode,
							bytes: size,
						};
					}
					base += Buffer.byteLength(body.slice(0, newline + 1));
					body = body.slice(newline + 1);
				}
				if (body.endsWith("\n")) body = body.slice(0, -1);
				return {
					ok: true,
					text: body,
					nextOffset: base,
					startOffset: base,
					hasMore: base > 0,
					eof: false,
					reset: false,
					truncated: base > 0,
					status: found.status,
					exitCode: found.exitCode,
					bytes: size,
				};
			}

			if (offset === undefined) {
				const all = raw.split("\n");
				if (all.length > 1 && all[all.length - 1] === "") all.pop();
				const dropped = Math.max(0, all.length - lines);
				const kept = all.slice(dropped);
				const prefix = dropped > 0 ? `${all.slice(0, dropped).join("\n")}\n` : "";
				const startOffset = from + Buffer.byteLength(prefix);
				return {
					ok: true,
					text: kept.join("\n"),
					nextOffset: size,
					startOffset,
					hasMore: startOffset > 0,
					eof: true,
					reset,
					truncated: startOffset > 0,
					status: found.status,
					exitCode: found.exitCode,
					bytes: size,
				};
			}
			return {
				ok: true,
				text: raw,
				nextOffset: end,
				startOffset: from,
				hasMore: from > 0,
				eof: end >= size,
				reset,
				truncated: end < size,
				status: found.status,
				exitCode: found.exitCode,
				bytes: size,
			};
		} finally {
			await handle.close();
		}
	}

	async function stop(id: string, by: "model" | "user", partner?: string): Promise<{ ok: boolean; error?: string }> {
		if (partner) await ensureHistory(partner);
		const task = tasks.get(id);
		if (!task) {
			if (pastById.has(id)) return { ok: true };
			return { ok: false, error: `unknown task ${id}` };
		}
		if (task.status !== "running") return { ok: true };
		task.stopping = true;
		clearDeadline(task);
		// Only the subscriber's own stop is silent: a user stopping it from the dialog must still wake the model.
		if (by === "model") task.exitSubscribed = false;
		task.proc.kill();
		return { ok: true };
	}

	async function subscribe(id: string, remindAfterSec?: number, partner?: string): Promise<TaskSubscribeResult | TaskFailure> {
		if (partner) await ensureHistory(partner);
		const task = tasks.get(id);
		if (!task) {
			const historic = pastById.get(id);
			if (historic) return { ok: true, exited: true, ...(historic.exitCode !== undefined ? { exitCode: historic.exitCode } : {}), remindAfter: DEFAULT_REMIND_AFTER_SEC };
			return { ok: false, error: `unknown task ${id}` };
		}
		const remindAfter = remindAfterSec !== undefined && Number.isFinite(remindAfterSec) && remindAfterSec > 0 ? remindAfterSec : DEFAULT_REMIND_AFTER_SEC;
		if (task.status !== "running") {
			return { ok: true, exited: true, ...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}), remindAfter };
		}
		task.exitSubscribed = true;
		clearDeadline(task);
		task.deadline = setTimeout(() => {
			task.deadline = null;
			if (task.status === "running") deps.notify(task.partner, task.id, "deadline", remindAfter);
		}, remindAfter * 1000);
		return { ok: true, exited: false, remindAfter };
	}

	function reapAll(): void {
		for (const task of tasks.values()) {
			if (task.status !== "running") continue;
			task.stopping = true;
			task.exitSubscribed = false;
			clearDeadline(task);
			task.proc.kill();
		}
	}

	return { start, get, list, listRunning, read, stop, subscribe, reapAll };
}

export type TaskRegistry = ReturnType<typeof createTaskRegistry>;
