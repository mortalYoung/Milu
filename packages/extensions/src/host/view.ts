import { LOG_EVENTS, type SeqEntry } from "@milu/protocol";

export type LogEntry = SeqEntry["entry"];

export type ToolStatus = "running" | "success" | "error";
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

export interface ViewItem {
	id: string;
	kind: "user" | "assistant" | "escalation" | "error" | "aborted" | "sep";
	text: string;
	time: number;
	from?: string;
	to?: string;
	peerKind?: "ask" | "reply";
	requestId?: string;
	schedule?: ViewSchedule;
	thinking?: { text: string; redacted?: boolean };
	tool?: ViewTool;
	say?: true;
	stepMs?: number;
	escalation?: ViewEscalation;
}

export interface StepGroup {
	readonly key: string;
	readonly rows: readonly ViewItem[];
}

export type DisplayRow = { readonly item: ViewItem } | { readonly step: StepGroup };

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
	const words = blocks.findIndex((block) => block.type === "text" && String(block.text ?? "").trim() !== "");
	blocks.forEach((block, index) => {
		const id = index === words || (words === -1 && index === 0) ? entry.id : `${entry.id}-${index}`;
		if (block.type === "text") {
			const text = String(block.text ?? "").trim();
			if (text !== "") out.push({ id, kind: "assistant", text, time, ...step });
			return;
		}
		if (block.type === "thinking") {
			const text = String(block.thinking ?? "").trim();
			if (text === "" && block.redacted !== true) return;
			out.push({ id, kind: "assistant", text: "", time, ...step, thinking: { text, ...(block.redacted === true ? { redacted: true } : {}) } });
			return;
		}
		if (block.type === "toolCall") {
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

function agentEndVisit(entry: LogEntry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { reason?: unknown; error?: unknown; timestamp?: unknown } | undefined;
	const time = typeof data?.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0);
	if (data?.reason === "aborted") out.push({ id: entry.id, kind: "aborted", text: "stopped", time });
	else if (data?.reason === "error" && typeof data.error === "string") out.push({ id: entry.id, kind: "error", text: data.error, time });
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
	[LOG_EVENTS.escalationRequest]: escalationVisit,
	[LOG_EVENTS.escalationDecision]: escalationDecisionVisit,
	[LOG_EVENTS.scheduleRun]: scheduleRunVisit,
	[LOG_EVENTS.rewind]: rewindVisit,
};

export function projectView(entries: readonly LogEntry[]): ViewItem[] {
	const out: ViewItem[] = [];
	for (const entry of entries) VISITORS[entryKey(entry)]?.(entry, out);
	markProcessText(entries, out);
	attachPeerPosts(entries, out);
	return out;
}

const stepKeyOf = (item: ViewItem): string | null => (item.tool || item.thinking || item.say ? item.id.replace(/-\d{1,2}$/, "") : null);

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

export function stepSummary(rows: readonly ViewItem[]): readonly { text: string; fail?: boolean }[] {
	const tools = rows.filter((row) => row.tool).length;
	const failed = rows.filter((row) => row.tool?.status === "error").length;
	const perStep = new Map<string, number>();
	for (const row of rows) {
		const key = stepKeyOf(row);
		if (key == null || row.stepMs == null || perStep.has(key)) continue;
		perStep.set(key, row.stepMs);
	}
	const ms = [...perStep.values()].reduce((total, value) => total + value, 0);
	const parts: { text: string; fail?: boolean }[] = [];
	if (ms >= 1000) parts.push({ text: `${(ms / 1000).toFixed(1)}s` });
	if (tools > 0) parts.push({ text: `${tools} tool${tools === 1 ? "" : "s"}` });
	if (failed > 0) parts.push({ text: `${failed} failed`, fail: true });
	if (parts.length === 0) parts.push({ text: `${rows.length} thought${rows.length === 1 ? "" : "s"}` });
	return parts;
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
