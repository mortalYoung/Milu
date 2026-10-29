import { LOG_EVENTS, type PartialMessage, type SeqEntry } from "@milu/protocol";

export type LogEntry = SeqEntry["entry"];

export type ToolStatus = "pending" | "running" | "success" | "error";
export type EscalationStatus = "pending" | "approved" | "rejected" | "dropped";

export interface ViewTool {
	callId: string;
	name: string;
	summary: string;
	status: ToolStatus;
	args?: string;
	result?: string;
	isError?: boolean;
}

export interface ViewSchedule {
	scheduleId: string;
	title: string;
	runId?: string;
	trigger?: "schedule" | "manual" | "catchup";
	status?: "dispatched" | "skipped" | "missed";
	error?: string;
}

export interface ViewEscalation {
	id: string;
	command: string;
	from: string;
	to: string;
	justification: string;
	status: EscalationStatus;
}

export interface ViewCommand {
	commandId: string;
	name: string;
	args?: string;
	text?: string;
	status: "running" | "success" | "error";
}

export interface ViewItem {
	id: string;
	kind: "user" | "assistant" | "escalation" | "error" | "aborted" | "shell" | "sep" | "command";
	text: string;
	time: number;
	from?: string;
	to?: string;
	peerKind?: "ask" | "reply";
	requestId?: string;
	schedule?: ViewSchedule;
	thinking?: { text: string; redacted?: boolean };
	tool?: ViewTool;
	command?: ViewCommand;
	stepMs?: number;
	say?: true;
	live?: true;
	stopped?: true;
	/** The files this run wrote, absolute and inside the workspace — the words a message may link. */
	files?: readonly string[];
	escalation?: ViewEscalation;
	shell?: { readonly output: string; readonly exitCode?: number };
}

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function dayOf(time: number): string {
	const date = new Date(time);
	return `${WEEKDAYS[date.getDay()]} · ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatHistoryTime(time: number): string {
	const date = new Date(time);
	const pad = (value: number) => String(value).padStart(2, "0");
	const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	const now = new Date();
	if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return clock;
	const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
	return date.getFullYear() === now.getFullYear() ? `${day} · ${clock}` : `${day} ${date.getFullYear()} · ${clock}`;
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function stringifyArgs(args: unknown): string {
	if (typeof args === "string") return args;
	if (args == null) return "";
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const value = block as { type?: unknown; text?: unknown };
			if (value.type === "text") return String(value.text ?? "");
			if (value.type === "image") return "(image)";
			return "";
		})
		.join("\n");
}

function entryKey(entry: LogEntry): string {
	if (entry.type === "message") return `role:${entry.message.role}`;
	if (entry.type === "custom") return entry.customType;
	return entry.type;
}

function findLast(out: readonly ViewItem[], predicate: (item: ViewItem) => boolean): ViewItem | undefined {
	for (let index = out.length - 1; index >= 0; index -= 1) {
		const item = out[index];
		if (item && predicate(item)) return item;
	}
	return undefined;
}

function userVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "message" || entry.message.role !== "user") return;
	const message = entry.message as {
		content?: unknown;
		timestamp?: number;
		skill?: unknown;
		from?: unknown;
		peerKind?: unknown;
		requestId?: unknown;
		scheduleId?: unknown;
		scheduleRunId?: unknown;
		scheduleTitle?: unknown;
	};
	if (typeof message.skill === "string") return;
	out.push({
		id: entry.id,
		kind: "user",
		text: typeof message.content === "string" ? message.content : contentText(message.content),
		time: message.timestamp ?? entry.timestamp ?? 0,
		...(typeof message.from === "string" ? { from: message.from } : {}),
		...(message.peerKind === "ask" || message.peerKind === "reply" ? { peerKind: message.peerKind } : {}),
		...(typeof message.requestId === "string" ? { requestId: message.requestId } : {}),
		...(typeof message.scheduleId === "string"
			? {
					schedule: {
						scheduleId: message.scheduleId,
						title: typeof message.scheduleTitle === "string" ? message.scheduleTitle : message.scheduleId,
						status: "dispatched",
						...(typeof message.scheduleRunId === "string" ? { runId: message.scheduleRunId } : {}),
					},
				}
			: {}),
	});
}

interface AssistantBlock {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	redacted?: unknown;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
}

function assistantVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "message" || entry.message.role !== "assistant") return;
	const blocks = Array.isArray(entry.message.content) ? (entry.message.content as AssistantBlock[]) : [];
	const time = entry.message.timestamp ?? entry.timestamp ?? 0;
	const timing = (entry.message as { timing?: { turnStartTime?: unknown; completedTime?: unknown } }).timing;
	const step = typeof timing?.turnStartTime === "number" && typeof timing?.completedTime === "number" ? { stepMs: Math.max(0, timing.completedTime - timing.turnStartTime) } : {};
	const stopped = (entry.message as { stopReason?: unknown }).stopReason === "aborted" ? { stopped: true as const } : {};
	const words = blocks.findIndex((block) => block.type === "text" && String(block.text ?? "").trim() !== "");
	blocks.forEach((block, index) => {
		const id = index === words || (words === -1 && index === 0) ? entry.id : `${entry.id}-${index}`;
		if (block.type === "text") {
			const text = String(block.text ?? "").trim();
			if (text !== "") out.push({ id, kind: "assistant", text, time, ...step, ...stopped });
			return;
		}
		if (block.type === "thinking") {
			const text = String(block.thinking ?? "").trim();
			if (text === "" && block.redacted !== true) return;
			out.push({ id, kind: "assistant", text: "", time, ...step, ...stopped, thinking: { text, ...(block.redacted === true ? { redacted: true } : {}) } });
			return;
		}
		if (block.type === "toolCall") {
			if (stopped.stopped) return;
			out.push({
				id,
				kind: "assistant",
				text: "",
				time,
				...step,
				tool: {
					callId: String(block.id ?? ""),
					name: String(block.name ?? ""),
					summary: oneLine(stringifyArgs(block.arguments)),
					args: stringifyArgs(block.arguments),
					status: "running",
				},
			});
		}
	});
}

function toolResultVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { toolCallId?: unknown; content?: unknown; isError?: unknown } | undefined;
	const callId = typeof data?.toolCallId === "string" ? data.toolCallId : "";
	if (callId === "") return;
	const item = findLast(out, (row) => row.tool?.callId === callId);
	if (!item?.tool) return;
	const failed = data?.isError === true;
	item.tool.status = failed ? "error" : "success";
	item.tool.isError = failed;
	item.tool.result = contentText(data?.content);
}

function sendMessageVia(entry: LogEntry): "harness" | "command" | "shell" {
	if (entry.type !== "custom") return "command";
	const data = entry.data as { via?: unknown; toolCallId?: unknown } | undefined;
	const via = data?.via;
	if (via === "harness" || via === "command" || via === "shell") return via;
	const call = typeof data?.toolCallId === "string" ? data.toolCallId : "";
	if (call === "harness-delivery") return "harness";
	if (call.startsWith("shell:")) return "shell";
	return "command";
}

function sendMessageVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { text?: unknown; timestamp?: unknown } | undefined;
	if (!data || typeof data.text !== "string") return;
	if (sendMessageVia(entry) !== "command") return;
	out.push({ id: entry.id, kind: "assistant", text: data.text, time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0) });
}

function commandVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { commandId?: unknown; name?: unknown; args?: unknown; timestamp?: unknown } | undefined;
	if (data?.commandId == null) return;
	out.push({
		id: entry.id,
		kind: "command",
		text: String(data.name ?? ""),
		time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		command: {
			commandId: String(data.commandId),
			name: String(data.name ?? ""),
			status: "running",
			...(typeof data.args === "string" && data.args !== "" ? { args: data.args } : {}),
		},
	});
}

function commandDoneVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { commandId?: unknown; kind?: unknown; text?: unknown } | undefined;
	if (data?.commandId == null) return;
	const item = findLast(out, (row) => row.command?.commandId === String(data.commandId));
	if (!item?.command) return;
	item.command.status = data.kind === "error" ? "error" : "success";
	if (typeof data.text === "string" && data.text !== "") item.command.text = data.text;
}

function shellDoneVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { command?: unknown; text?: unknown; exitCode?: unknown; timestamp?: unknown } | undefined;
	if (typeof data?.command !== "string") return;
	out.push({
		id: entry.id,
		kind: "shell",
		text: data.command,
		time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		shell: { output: typeof data.text === "string" ? data.text : "", ...(typeof data.exitCode === "number" ? { exitCode: data.exitCode } : {}) },
	});
}

function agentEndVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { reason?: unknown; error?: unknown; timestamp?: unknown } | undefined;
	const time = typeof data?.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0);
	if (data?.reason === "aborted") {
		const previous = out[out.length - 1];
		if (previous && (previous.tool || previous.thinking || previous.say)) return;
		out.push({ id: entry.id, kind: "aborted", text: "stopped", time });
	} else if (data?.reason === "error" && typeof data.error === "string") out.push({ id: entry.id, kind: "error", text: data.error, time });
}

function escalationVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { escalationId?: unknown; command?: unknown; from?: unknown; to?: unknown; justification?: unknown; timestamp?: unknown } | undefined;
	if (data?.escalationId == null) return;
	out.push({
		id: entry.id,
		kind: "escalation",
		text: String(data.command ?? ""),
		time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		escalation: {
			id: String(data.escalationId),
			command: String(data.command ?? ""),
			from: String(data.from ?? ""),
			to: String(data.to ?? ""),
			justification: String(data.justification ?? ""),
			status: "pending",
		},
	});
}

function escalationDecisionVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { escalationId?: unknown; approved?: unknown; dropped?: unknown } | undefined;
	if (data?.escalationId == null) return;
	const status: EscalationStatus = data.dropped === true ? "dropped" : data.approved === true ? "approved" : "rejected";
	const item = findLast(out, (row) => row.kind === "escalation" && row.escalation?.id === String(data.escalationId));
	if (item?.escalation) item.escalation.status = status;
}

const isRunStatus = (value: unknown): value is NonNullable<ViewSchedule["status"]> => value === "dispatched" || value === "skipped" || value === "missed";

function scheduleRunVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { scheduleId?: unknown; scheduleTitle?: unknown; runId?: unknown; trigger?: unknown; status?: unknown; error?: unknown } | undefined;
	if (data?.scheduleId == null) return;
	const runId = typeof data.runId === "string" ? data.runId : "";
	const item = findLast(out, (row) => row.kind === "user" && row.schedule != null && (runId ? row.schedule.runId === runId : row.schedule.scheduleId === String(data.scheduleId)));
	if (!item?.schedule) return;
	item.schedule.status = isRunStatus(data.status) ? data.status : "dispatched";
	if (typeof data.runId === "string") item.schedule.runId = data.runId;
	if (data.trigger === "schedule" || data.trigger === "manual" || data.trigger === "catchup") item.schedule.trigger = data.trigger;
	if (typeof data.scheduleTitle === "string" && data.scheduleTitle) item.schedule.title = data.scheduleTitle;
	if (typeof data.error === "string" && data.error) item.schedule.error = data.error;
	else delete item.schedule.error;
}

function rewindVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { targetId?: unknown; text?: unknown; shadowedIds?: unknown } | undefined;
	if (data?.targetId == null || typeof data.text !== "string") return;
	const targetId = String(data.targetId);
	const item = findLast(out, (row) => row.kind === "user" && row.id === targetId);
	if (item?.kind === "user") item.text = data.text;
	if (!Array.isArray(data.shadowedIds)) return;
	const shadowed = new Set(data.shadowedIds.filter((id): id is string => typeof id === "string"));
	for (let index = out.length - 1; index >= 0; index -= 1) {
		if (shadowed.has(out[index]!.id)) out.splice(index, 1);
	}
}

function attachPeerPosts(entries: readonly LogEntry[], out: ViewItem[]): void {
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== LOG_EVENTS.sendMessage) continue;
		if (sendMessageVia(entry) !== "harness") continue;
		const data = entry.data as { to?: unknown; text?: unknown } | undefined;
		if (typeof data?.to !== "string") continue;
		const spoken = typeof data.text === "string" ? data.text : "";
		const target = findLast(out, (item) => item.kind === "assistant" && item.text === spoken) ?? findLast(out, (item) => item.kind === "assistant" && item.text !== "");
		if (target) target.to = data.to;
	}
}

const VISITORS: Readonly<Record<string, (entry: LogEntry, out: ViewItem[]) => void>> = {
	"role:user": userVisit,
	"role:assistant": assistantVisit,
	[LOG_EVENTS.toolResult]: toolResultVisit,
	[LOG_EVENTS.sendMessage]: sendMessageVisit,
	[LOG_EVENTS.agentEnd]: agentEndVisit,
	[LOG_EVENTS.shellDone]: shellDoneVisit,
	[LOG_EVENTS.escalationRequest]: escalationVisit,
	[LOG_EVENTS.escalationDecision]: escalationDecisionVisit,
	[LOG_EVENTS.scheduleRun]: scheduleRunVisit,
	[LOG_EVENTS.rewind]: rewindVisit,
	[LOG_EVENTS.commandRun]: commandVisit,
	[LOG_EVENTS.commandDone]: commandDoneVisit,
};

export function rowKindOf(item: ViewItem): string {
	if (item.tool) return "tool";
	if (item.thinking) return "thinking";
	if (item.say) return "say";
	return item.kind;
}

/** The in-flight assistant message, laid out exactly as the finished rows will be: steps above, the words last. */
export function liveRowsOf(message: PartialMessage, time: number): DisplayRow[] {
	if (message.role !== "assistant") return [];
	const blocks = Array.isArray(message.content) ? (message.content as AssistantBlock[]) : [];
	const items: ViewItem[] = [];
	let words = -1;
	blocks.forEach((block, index) => {
		const id = `live-${index}`;
		if (block.type === "text") {
			const text = String(block.text ?? "").trim();
			if (text === "") return;
			items.push({ id, kind: "assistant", text, time, live: true });
			words = items.length - 1;
			return;
		}
		if (block.type === "thinking") {
			const text = String(block.thinking ?? "").trim();
			if (text === "" && block.redacted !== true) return;
			items.push({ id, kind: "assistant", text: "", time, live: true, thinking: { text, ...(block.redacted === true ? { redacted: true } : {}) } });
			return;
		}
		if (block.type === "toolCall") {
			const name = String(block.name ?? "");
			if (name === "") return;
			const args = stringifyArgs(block.arguments);
			items.push({
				id,
				kind: "assistant",
				text: "",
				time,
				live: true,
				tool: { callId: String(block.id ?? ""), name, summary: args === "{}" ? "" : oneLine(args), args, status: "pending" },
			});
		}
	});
	items.forEach((item, index) => {
		if (index !== words && item.text !== "") item.say = true;
	});
	return layoutView(items);
}

function markProcessText(entries: readonly LogEntry[], out: readonly ViewItem[]): void {
	const textItems = new Map<string, number[]>();
	out.forEach((item, index) => {
		if (item.tool || item.thinking || item.text === "") return;
		const owner = item.id.replace(/-\d{1,2}$/, "");
		const list = textItems.get(owner);
		if (list) list.push(index);
		else textItems.set(owner, [index]);
	});
	let run: number[] = [];
	const flush = () => {
		for (const index of run.slice(0, -1)) {
			const item = out[index];
			if (item?.text) item.say = true;
		}
		run = [];
	};
	const closesReply = (type: string) => type === LOG_EVENTS.agentStart || type === LOG_EVENTS.agentEnd || type === LOG_EVENTS.turnStart || type === LOG_EVENTS.turnEnd;
	for (const entry of entries) {
		if (entry.type === "custom" && closesReply(entry.customType)) {
			flush();
			continue;
		}
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const indices = textItems.get(entry.id);
		if (indices) run.push(...indices);
	}
	flush();
}

// ——— the files a run wrote ———

type Producer = (args: unknown) => string | null;

const PRODUCERS: Readonly<Record<string, Producer>> = {
	write: (args) => {
		const record = parseRecord(args) as { path?: unknown; content?: unknown } | null;
		if (record === null) return null;
		const target = nonEmptyString(record.path);
		return target !== null && typeof record.content === "string" ? target : null;
	},
	edit: (args) => {
		const record = parseRecord(args) as { path?: unknown; edits?: unknown; oldText?: unknown; newText?: unknown } | null;
		if (record === null) return null;
		const target = nonEmptyString(record.path);
		return target !== null && hasChangingEdit(record.edits, record.oldText, record.newText) ? target : null;
	},
};

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value === "string") {
		try {
			return parseRecord(JSON.parse(value));
		} catch {
			return null;
		}
	}
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] | null {
	if (Array.isArray(value)) return value;
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function hasChangingEdit(edits: unknown, oldText: unknown, newText: unknown): boolean {
	const list = asArray(edits) ?? [{ oldText, newText }];
	for (const edit of list) {
		const record = parseRecord(edit) as { oldText?: unknown; newText?: unknown } | null;
		if (record === null) continue;
		const before = nonEmptyString(record.oldText);
		if (before !== null && typeof record.newText === "string" && before !== record.newText) return true;
	}
	return false;
}

const isAbsolutePath = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);

function workspacePath(path: string, baseDir: string): string {
	if (path === "" || isAbsolutePath(path)) return path;
	return `${baseDir.endsWith("/") ? baseDir.slice(0, -1) : baseDir}/${path}`;
}

/** Collapse `.` and `..` without a path module: this file runs in the renderer, which has no node. */
function normalizePath(path: string): string {
	const absolute = path.startsWith("/");
	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (segments.length > 0) segments.pop();
			else if (!absolute) segments.push("..");
			continue;
		}
		segments.push(segment);
	}
	return `${absolute ? "/" : ""}${segments.join("/")}`;
}

function insideWorkspace(path: string, baseDir: string): boolean {
	const root = normalizePath(baseDir);
	const target = normalizePath(path);
	return target === root || target.startsWith(`${root}/`);
}

/**
 * What each reply wrote: the run's `write` / `edit` calls that landed without error, made absolute and
 * kept inside the workspace, attached to the last assistant message that carried words. A mention the
 * markdown layer can link, and a list no one can invent by writing `../` in a tool call.
 */
export function attachMentionFiles(entries: readonly LogEntry[], items: readonly ViewItem[], baseDir: string | null): void {
	if (baseDir === null || baseDir === "") return;
	const calls = new Map<string, { run: string; path: string | null }>();
	const produced: { run: string; path: string }[] = [];
	const closing = new Map<string, string>();
	const closed = new Set<string>();
	let run = "";
	for (const entry of entries) {
		if (entry.type === "message") {
			if (run === "" || entry.message.role !== "assistant" || contentText(entry.message.content).trim() === "") continue;
			closing.set(run, entry.id);
			continue;
		}
		if (entry.type !== "custom") continue;
		if (entry.customType === LOG_EVENTS.agentStart) {
			run = entry.id;
			continue;
		}
		if (entry.customType === LOG_EVENTS.agentEnd) {
			closed.add(run);
			continue;
		}
		const data = (entry.data ?? {}) as { callId?: unknown; toolCallId?: unknown; name?: unknown; args?: unknown; isError?: unknown };
		if (entry.customType === LOG_EVENTS.toolCall) {
			const callId = nonEmptyString(data.callId);
			if (callId === null) continue;
			const produce = PRODUCERS[nonEmptyString(data.name) ?? ""];
			calls.set(callId, { run, path: produce === undefined ? null : produce(data.args) });
			continue;
		}
		if (entry.customType !== LOG_EVENTS.toolResult || data.isError === true) continue;
		const callId = nonEmptyString(data.toolCallId);
		const call = callId === null ? undefined : calls.get(callId);
		if (call === undefined || call.path === null) continue;
		const absolute = normalizePath(workspacePath(call.path, baseDir));
		if (!insideWorkspace(absolute, baseDir)) continue;
		produced.push({ run: call.run, path: absolute });
	}
	const byItem = new Map<string, string[]>();
	for (const [owner, id] of closing) {
		if (!closed.has(owner)) continue;
		const files: string[] = [];
		for (const file of produced) {
			if (file.run !== owner || files.includes(file.path)) continue;
			files.push(file.path);
		}
		if (files.length > 0) byItem.set(id, files);
	}
	for (const item of items) {
		const files = byItem.get(item.id);
		if (files !== undefined) item.files = files;
	}
}

export function projectView(entries: readonly LogEntry[], options: { baseDir?: string | null } = {}): ViewItem[] {
	const out: ViewItem[] = [];
	for (const entry of entries) VISITORS[entryKey(entry)]?.(entry, out);
	markProcessText(entries, out);
	attachPeerPosts(entries, out);
	attachMentionFiles(entries, out, options.baseDir ?? null);
	return out;
}

export interface StepGroup {
	readonly key: string;
	readonly rows: readonly ViewItem[];
}

export type DisplayRow = { readonly item: ViewItem } | { readonly step: StepGroup };

function foldSteps(items: readonly ViewItem[]): DisplayRow[] {
	const out: DisplayRow[] = [];
	let rows: ViewItem[] = [];
	const flush = (key?: string) => {
		if (rows.length === 0) return;
		const group = rows;
		rows = [];
		out.push({ step: { key: key ?? group[0]!.id, rows: group } });
	};
	for (const item of items) {
		if (item.tool || item.thinking || item.say) {
			rows.push(item);
			continue;
		}
		flush(item.kind === "assistant" ? item.id : undefined);
		out.push({ item });
	}
	flush();
	return out;
}

export function layoutView(items: readonly ViewItem[]): DisplayRow[] {
	const out: ViewItem[] = [];
	let lastDay = "";
	for (const item of items) {
		if (item.kind !== "error" && item.kind !== "aborted") {
			const day = dayOf(item.time);
			if (lastDay !== "" && day !== lastDay) out.push({ id: `sep:${day}`, kind: "sep", text: day, time: item.time });
			lastDay = day;
		}
		out.push(item);
	}
	return foldSteps(out);
}

export interface ReplyRow {
	readonly id: string;
	readonly question: string;
	readonly questionId?: string;
	readonly text: string;
	readonly time: number;
	readonly count: number;
}

function answerOf(previous: ReplyRow | null, item: ViewItem, question: string, questionId: string | undefined): ReplyRow {
	if (previous === null) return { id: item.id, question, questionId, text: item.text, time: item.time, count: 1 };
	return { ...previous, id: item.id, text: item.text, time: item.time, count: previous.count + 1 };
}

export function replyRows(items: readonly ViewItem[]): readonly ReplyRow[] {
	const out: ReplyRow[] = [];
	let question = "";
	let questionId: string | undefined;
	let current: ReplyRow | null = null;
	const close = () => {
		if (!current) return;
		out.push(current);
		current = null;
	};
	for (const item of items) {
		if (item.kind === "user") {
			close();
			question = item.text;
			questionId = item.id;
			continue;
		}
		if (item.kind === "assistant" && item.text.trim() !== "") {
			current = answerOf(current, item, question, questionId);
			continue;
		}
		if (item.kind === "error" || item.kind === "sep") close();
	}
	close();
	return out;
}
