import { appendFile, mkdir, open, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type ExecutionEnv, EVENTS, type Session } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

const DEFAULT_LINES = 200;
const MAX_READ_BYTES = 50 * 1024;

export const DEFAULT_REMIND_AFTER_SEC = 180;

type TaskStatus = "running" | "exited" | "killed" | "interrupted";

interface LiveTask {
	readonly id: string;
	readonly session: Session;
	readonly command: string;
	readonly logPath: string;
	readonly startedAt: number;
	readonly controller: AbortController;
	queue: Promise<void>;
	bytes: number;
	status: TaskStatus;
	endedAt?: number;
	exitCode?: number;
	subscribed: boolean;
	notified: boolean;
	deadline: ReturnType<typeof setTimeout> | null;
}

interface Start {
	readonly command: string;
	readonly logPath: string;
	readonly startedAt: number;
}

interface End {
	readonly status: TaskStatus;
	readonly exitCode?: number;
	readonly endedAt: number;
}

interface Scan {
	readonly starts: Map<string, Start>;
	readonly ends: Map<string, End>;
}

export interface TaskSummary {
	readonly id: string;
	readonly command: string;
	readonly logPath: string;
	readonly status: TaskStatus;
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly exitCode?: number;
	readonly bytes: number;
}

export interface TaskRead {
	readonly ok: true;
	readonly text: string;
	readonly status: string;
	readonly exitCode?: number;
	readonly bytes: number;
}

export interface TaskFailure {
	readonly ok: false;
	readonly error: string;
}

export class TaskService implements Service {
	private readonly _live = new Map<string, LiveTask>();
	private readonly _reconciled = new Set<string>();
	private _seq = 0;

	async start(session: Session, env: ExecutionEnv, command: string): Promise<{ readonly ok: true; readonly id: string } | TaskFailure> {
		const id = `task-${Date.now().toString(36)}-${++this._seq}`;
		const dir = join(session.root, "tasks");
		await mkdir(dir, { recursive: true });
		const logPath = join(dir, `${id}.log`);
		await writeFile(logPath, "", "utf8");
		await session.record(EVENTS.taskStart, { taskId: id, command, logPath, timestamp: Date.now() });

		const task: LiveTask = {
			id,
			session,
			command,
			logPath,
			startedAt: Date.now(),
			controller: new AbortController(),
			queue: Promise.resolve(),
			bytes: 0,
			status: "running",
			subscribed: false,
			notified: false,
			deadline: null,
		};
		this._live.set(id, task);

		const write = (chunk: string): void => {
			if (chunk === "") return;
			task.bytes += Buffer.byteLength(chunk);
			task.queue = task.queue.then(() => appendFile(logPath, chunk)).catch(() => {});
		};

		void env
			.exec(command, { abortSignal: task.controller.signal, onStdout: write, onStderr: write })
			.then(async (result) => {
				if (!result.ok && result.error.code !== "aborted") write(`${result.error.message}\n`);
				await task.queue;
				task.status = !result.ok && result.error.code === "aborted" ? "killed" : "exited";
				task.endedAt = Date.now();
				if (result.ok) task.exitCode = result.value.exitCode;
				if (task.deadline) clearTimeout(task.deadline);
				await session.record(EVENTS.taskEnd, { taskId: id, status: task.status, ...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }), timestamp: Date.now() });
				if (task.subscribed && !task.notified) {
					task.notified = true;
					await session.deliver(endedText(task));
				}
			})
			.catch((error: unknown) => console.error(`task ${id} failed:`, error));

		return { ok: true, id };
	}

	async summary(session: Session): Promise<{ running: number; total: number }> {
		const tasks = await this.list(session);
		return { running: tasks.filter((task) => task.status === "running").length, total: tasks.length };
	}

	async list(session: Session): Promise<readonly TaskSummary[]> {
		const scan = await this._scan(session);
		await this._ensure(session, scan);
		const seen = new Set<string>();
		const tasks: TaskSummary[] = [];
		for (const task of this._live.values()) {
			if (task.session.name !== session.name) continue;
			seen.add(task.id);
			tasks.push({
				id: task.id,
				command: task.command,
				logPath: task.logPath,
				status: task.status,
				startedAt: task.startedAt,
				...(task.status === "running" ? {} : { endedAt: task.endedAt }),
				...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }),
				bytes: task.bytes,
			});
		}
		for (const [id, start] of scan.starts) {
			if (seen.has(id)) continue;
			const end = scan.ends.get(id);
			if (!end) continue;
			tasks.push({
				id,
				command: start.command,
				logPath: start.logPath,
				status: end.status,
				startedAt: start.startedAt,
				endedAt: end.endedAt,
				...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }),
				bytes: await sizeOf(start.logPath),
			});
		}
		return tasks.sort((left, right) => left.startedAt - right.startedAt);
	}

	async dialogData(session: Session): Promise<{ session: string; tasks: (TaskSummary & { text: string })[] }> {
		const tasks: (TaskSummary & { text: string })[] = [];
		for (const summary of await this.list(session)) {
			const tail = await readTail(summary.logPath, 200);
			tasks.push({ ...summary, text: tail.text });
		}
		return { session: session.name, tasks };
	}

	async read(session: Session, id: string, options: { lines?: number } = {}): Promise<TaskRead | TaskFailure> {
		const scan = await this._scan(session);
		await this._ensure(session, scan);
		const live = this._live.get(id);
		const start = scan.starts.get(id);
		const end = scan.ends.get(id);
		if (!live && (!start || !end)) return { ok: false, error: `no task "${id}"` };
		if (live) await live.queue;

		const logPath = live?.logPath ?? start?.logPath ?? "";
		const tail = await readTail(logPath, options.lines ?? DEFAULT_LINES);
		const status = live?.status ?? end?.status ?? "running";
		const exitCode = live?.exitCode ?? end?.exitCode;
		return { ok: true, text: tail.text, status, ...(exitCode === undefined ? {} : { exitCode }), bytes: live?.bytes ?? tail.bytes };
	}

	async subscribe(session: Session, id: string, remindAfterSec?: number): Promise<{ ok: true; exited: boolean; exitCode?: number; remindAfter: number } | TaskFailure> {
		const remindAfter = remindAfterSec !== undefined && Number.isFinite(remindAfterSec) && remindAfterSec > 0 ? remindAfterSec : DEFAULT_REMIND_AFTER_SEC;
		const scan = await this._scan(session);
		await this._ensure(session, scan);
		const live = this._live.get(id);
		if (!live) {
			const start = scan.starts.get(id);
			const end = start ? scan.ends.get(id) : undefined;
			if (!end) return { ok: false, error: `no task "${id}"` };
			return { ok: true, exited: true, ...(end.exitCode === undefined ? {} : { exitCode: end.exitCode }), remindAfter };
		}
		if (live.status !== "running") return { ok: true, exited: true, ...(live.exitCode === undefined ? {} : { exitCode: live.exitCode }), remindAfter };

		live.subscribed = true;
		if (!live.deadline) {
			live.deadline = setTimeout(() => {
				if (live.status !== "running") return;
				void live.session.deliver(deadlineText(live, remindAfter));
			}, remindAfter * 1000);
		}
		return { ok: true, exited: false, remindAfter };
	}

	async stop(id: string): Promise<{ ok: boolean; error?: string }> {
		const live = this._live.get(id);
		if (!live) return { ok: false, error: `task "${id}" is not running` };
		if (live.status !== "running") return { ok: true };
		live.controller.abort();
		return { ok: true };
	}

	dispose(): void {
		for (const task of this._live.values()) {
			if (task.deadline) clearTimeout(task.deadline);
			task.controller.abort();
		}
		this._live.clear();
	}

	private async _scan(session: Session): Promise<Scan> {
		const starts = new Map<string, Start>();
		const ends = new Map<string, End>();

		for (const { entry } of await session.records(EVENTS.taskStart)) {
			if (entry.type !== "custom") continue;
			const data = entry.data as { taskId?: unknown; command?: unknown; logPath?: unknown; timestamp?: unknown } | undefined;
			if (typeof data?.taskId !== "string" || typeof data.logPath !== "string") continue;
			starts.set(data.taskId, {
				command: String(data.command ?? ""),
				logPath: data.logPath,
				startedAt: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
			});
		}

		for (const { entry } of await session.records(EVENTS.taskEnd)) {
			if (entry.type !== "custom") continue;
			const data = entry.data as { taskId?: unknown; status?: unknown; exitCode?: unknown; timestamp?: unknown } | undefined;
			if (typeof data?.taskId !== "string") continue;
			ends.set(data.taskId, {
				status: data.status === "killed" ? "killed" : data.status === "interrupted" ? "interrupted" : "exited",
				...(typeof data.exitCode === "number" ? { exitCode: data.exitCode } : {}),
				endedAt: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
			});
		}

		return { starts, ends };
	}

	private async _ensure(session: Session, scan: Scan): Promise<void> {
		if (this._reconciled.has(session.name)) return;
		this._reconciled.add(session.name);

		for (const id of scan.starts.keys()) {
			if (scan.ends.has(id) || this._live.has(id)) continue;
			const at = Date.now();
			await session.record(EVENTS.taskEnd, { taskId: id, status: "interrupted", timestamp: at });
			scan.ends.set(id, { status: "interrupted", endedAt: at });
		}
	}
}

export const TaskServiceId = createServiceId<TaskService>("tasks.service");

function endedText(task: LiveTask): string {
	const head = task.status === "killed" ? `[task ${task.id}] stopped` : `[task ${task.id}] ended${task.exitCode !== undefined ? ` (exit ${task.exitCode})` : ""}`;
	return [head, `$ ${task.command}`, `task { op: "read", id: "${task.id}" } for output`].join("\n");
}

function deadlineText(task: LiveTask, remindAfter: number): string {
	return [
		`[task ${task.id}] still running at ${remindAfter}s`,
		`You will still be notified when it ends.`,
		`task { op: "read", id: "${task.id}" } for output · task { op: "stop", id: "${task.id}" } to kill it`,
	].join("\n");
}

async function sizeOf(path: string): Promise<number> {
	const info = await stat(path).catch(() => null);
	return info?.size ?? 0;
}

async function readTail(path: string, lines: number): Promise<{ text: string; bytes: number }> {
	const handle = await open(path, "r").catch(() => null);
	if (!handle) return { text: "", bytes: 0 };
	try {
		const { size } = await handle.stat();
		const length = Math.min(size, MAX_READ_BYTES);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, size - length);
		const all = buffer.toString("utf8").split("\n");
		return { text: all.slice(Math.max(0, all.length - lines)).join("\n"), bytes: size };
	} finally {
		await handle.close();
	}
}
