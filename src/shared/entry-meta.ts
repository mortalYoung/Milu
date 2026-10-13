import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { type CompactionEventData, contextChangedText, EVENTS, instructionsChangedText, mcpChangedText, type RewindEventData } from "./events";
import { attachMentionFiles } from "./file-mentions";
import { contentText, eventNumber, type RawUsage, toTrajectoryUsage } from "./record";
import type { EntryPayload, SandboxMode, TrajectoryBlock, TrajectoryRecord, TrajectoryUsage, ViewItem } from "./rpc";

// ——— metadata types ———

export interface ViewMeta {
	visit?(entry: Entry, out: ViewItem[]): void;
}

export interface SliceItem {
	id: string;
	message: AgentMessage;
}

export interface SliceContext {
	entry: Entry;
	index: number;
	entries: Entry[];
	out: SliceItem[];
	keepDangling: boolean;
}

export interface ContextMeta {
	visit?(ctx: SliceContext): void;
}

export interface SliceMeta {
	as?(record: TrajectoryRecord): TrajectoryRecord;
}

export interface OriginMeta {
	visit?(entry: Entry, out: Entry[]): void;
}

export type TrajectoryTone = "plain" | "user" | "skill" | "result" | "message" | "system" | "reminder" | "request" | "decision" | "change" | "compact" | "custom";

export interface TrajectoryDetail {
	label?: string;
	description?: string;
	content?: { kind: "text" | "code" | "json"; value: string };
	meta?: string[];
	error?: boolean;
}

export interface TrajectoryRow {
	chip?: string;
	tone?: TrajectoryTone;
	caption?: string;
	details?: TrajectoryDetail[];
}

export interface TrajectoryNode {
	chip?: string;
	tone?: TrajectoryTone;
	caption?: string;
	details?: TrajectoryDetail[];
	rows?: TrajectoryRow[];
}

export interface Cursor {
	run: number;
	turn: number;
	open: boolean;
}

export interface EntryMeta {
	origin?: OriginMeta;
	view?: ViewMeta;
	context?: ContextMeta;
	slice?: SliceMeta;
	trajectory?: (record: TrajectoryRecord) => TrajectoryNode;
	data?: (entry: Entry) => EntryPayload | null;
	cursor?: (state: Cursor, entry: Entry) => void;
	close?: boolean;
	hidden?: boolean;
	dedupe?: boolean;
	pin?: string;
}

// ——— view projection ———

const row = (id: string, kind: ViewItem["kind"], text: string, time: number): ViewItem => ({ id, kind, text, time });

function findLast(out: ViewItem[], predicate: (item: ViewItem) => boolean): ViewItem | undefined {
	for (let i = out.length - 1; i >= 0; i--) {
		if (predicate(out[i])) return out[i];
	}
	return undefined;
}

function userVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "message" || entry.message.role !== "user") return;
	const content = entry.message.content;
	const meta = entry.message as { skill?: unknown; from?: unknown; peerKind?: unknown; requestId?: unknown };
	const text = typeof content === "string" ? content : "";
	out.push({
		...row(entry.id, "user", text, entry.message.timestamp ?? entry.timestamp ?? 0),
		...(typeof meta.skill === "string" ? { skillName: meta.skill } : {}),
		...(typeof meta.from === "string" ? { from: meta.from } : {}),
		...(meta.peerKind === "ask" || meta.peerKind === "reply" ? { peerKind: meta.peerKind } : {}),
		...(typeof meta.requestId === "string" ? { requestId: meta.requestId } : {}),
	});
}

/** How a `send_message` was produced. `via` is explicit on new logs; the tool call id is the
 *  legacy tell, kept so old sessions read the same way. */
export function sendMessageVia(entry: Entry): "harness" | "command" | "shell" {
	if (entry.type !== "custom") return "command";
	const data = entry.data as { via?: unknown; toolCallId?: unknown } | undefined;
	const via = data?.via;
	if (via === "harness" || via === "command" || via === "shell") return via;
	const call = typeof data?.toolCallId === "string" ? data.toolCallId : "";
	if (call === "harness-delivery") return "harness";
	if (call.startsWith("shell:")) return "shell";
	return "command";
}

/** A line a command or a skill posted. The harness's own deliveries are legacy: the assistant entry
 *  carries the same words now, and only the fact they went out is kept (see attachPeerPosts). */
function sendMessageVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { text?: unknown; timestamp?: unknown } | undefined;
	if (!data || typeof data.text !== "string") return;
	if (sendMessageVia(entry) !== "command") return;
	out.push(row(entry.id, "assistant", data.text, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)));
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

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The assistant's own blocks, in the order it produced them: what it thought, what it called, what
 *  it said. This is where a message becomes visible; a block that produced nothing is skipped. */
function assistantVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "message" || entry.message.role !== "assistant") return;
	const blocks = Array.isArray(entry.message.content) ? (entry.message.content as AssistantBlock[]) : [];
	const time = entry.message.timestamp ?? entry.timestamp ?? 0;
	// A step's wall clock, off the entry's own timing: what the folded summary reports.
	const timing = (entry.message as { timing?: { turnStartTime?: unknown; completedTime?: unknown } }).timing;
	const step = typeof timing?.turnStartTime === "number" && typeof timing?.completedTime === "number" ? { stepMs: Math.max(0, timing.completedTime - timing.turnStartTime) } : {};
	const words = blocks.findIndex((block) => block.type === "text" && trimmed(block.text) !== "");
	blocks.forEach((block, index) => {
		const id = index === words || (words === -1 && index === 0) ? entry.id : `${entry.id}-${index}`;
		if (block.type === "text") {
			const value = trimmed(block.text);
			if (value !== "") out.push({ ...row(id, "assistant", value, time), ...step });
			return;
		}
		if (block.type === "thinking") {
			const value = trimmed(block.thinking);
			if (value === "" && block.redacted !== true) return;
			out.push({ ...row(id, "assistant", "", time), ...step, thinking: { text: value, ...(block.redacted === true ? { redacted: true } : {}) } });
			return;
		}
		if (block.type === "toolCall") {
			out.push({
				...row(id, "assistant", "", time),
				...step,
				tool: {
					callId: String(block.id ?? ""),
					name: String(block.name ?? ""),
					summary: stringifyArgs(block.arguments).replace(/\s+/g, " ").trim(),
					args: stringifyArgs(block.arguments),
					status: "running",
				},
			});
		}
	});
}

/** A tool result is not a message: it hangs on the call it answers, closed until someone asks. */
function toolResultVisit(entry: Entry, out: ViewItem[]): void {
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

/** A turn's body is the last thing it said. Everything the same turn said before that is process, and
 *  belongs in the timeline with the calls it made — the reader asked for one answer, not five. A queued
 *  follow-up runs as its own turn inside the same agent run, and that turn's answer is a body too. */
function markProcessText(entries: Entry[], out: ViewItem[]): void {
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
	const closesReply = (type: string) => type === EVENTS.agentStart || type === EVENTS.agentEnd || type === EVENTS.turnStart || type === EVENTS.turnEnd;
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

/** A harness copy of an answer that was also posted to a peer is not a message of its own: it is the
 *  record that the words went out, so it decorates the bubble that carries them. */
function attachPeerPosts(entries: Entry[], out: ViewItem[]): void {
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== EVENTS.sendMessage) continue;
		if (sendMessageVia(entry) !== "harness") continue;
		const data = entry.data as { to?: unknown; text?: unknown } | undefined;
		if (typeof data?.to !== "string") continue;
		const spoken = typeof data.text === "string" ? data.text : "";
		const target = findLast(out, (item) => item.kind === "assistant" && item.text === spoken) ?? findLast(out, (item) => item.kind === "assistant" && item.text !== "");
		if (target) target.to = data.to;
	}
}

function agentEndVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { reason?: unknown; error?: unknown; timestamp?: unknown } | undefined;
	const time = typeof data?.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0);
	if (data?.reason === "aborted") out.push(row(entry.id, "aborted", "stopped", time));
	else if (data?.reason === "error" && typeof data.error === "string") out.push(row(entry.id, "error", data.error, time));
}

function escalationVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { escalationId?: unknown; command?: unknown; from?: unknown; to?: unknown; justification?: unknown; timestamp?: unknown } | undefined;
	if (data?.escalationId == null) return;
	out.push({
		...row(entry.id, "escalation", String(data.command ?? ""), typeof data.timestamp === "number" ? data.timestamp : 0),
		escalation: {
			id: String(data.escalationId),
			command: String(data.command ?? ""),
			from: data.from as SandboxMode,
			to: data.to as SandboxMode,
			justification: String(data.justification ?? ""),
			status: "pending",
		},
	});
}

function escalationDecisionVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { escalationId?: unknown; approved?: unknown; dropped?: unknown } | undefined;
	if (data?.escalationId == null) return;
	const status = data.dropped === true ? "dropped" : data.approved === true ? "approved" : "rejected";
	const item = findLast(out, (r) => r.kind === "escalation" && r.escalation?.id === String(data.escalationId));
	if (item?.kind === "escalation" && item.escalation) item.escalation.status = status;
}

function commandVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { commandId?: unknown; name?: unknown; args?: unknown; timestamp?: unknown } | undefined;
	if (data?.commandId == null) return;
	const name = String(data.name ?? "");
	out.push({
		...row(entry.id, "command", name, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)),
		command: {
			commandId: String(data.commandId),
			name,
			...(typeof data.args === "string" ? { args: data.args } : {}),
			status: "running",
		},
	});
}

function commandDoneVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { commandId?: unknown; kind?: unknown; text?: unknown } | undefined;
	if (data?.commandId == null) return;
	const item = findLast(out, (r) => r.kind === "command" && r.command?.commandId === String(data.commandId));
	if (item?.kind !== "command" || !item.command) return;
	item.command.status = data.kind === "error" ? "error" : "success";
	if (typeof data.text === "string") item.command.text = data.text;
}

function skillVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { skillId?: unknown; name?: unknown; hint?: unknown; timestamp?: unknown } | undefined;
	if (data?.skillId == null) return;
	const name = String(data.name ?? "");
	out.push({
		...row(entry.id, "skill", name, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)),
		skill: {
			commandId: String(data.skillId),
			name,
			...(typeof data.hint === "string" && data.hint ? { args: data.hint } : {}),
			status: "running",
		},
	});
}

function skillDoneVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { skillId?: unknown; kind?: unknown; text?: unknown } | undefined;
	if (data?.skillId == null) return;
	const item = findLast(out, (r) => r.kind === "skill" && r.skill?.commandId === String(data.skillId));
	if (item?.kind !== "skill" || !item.skill) return;
	item.skill.status = data.kind === "error" ? "error" : "success";
	if (typeof data.text === "string") item.skill.text = data.text;
}

function shellVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { shellId?: unknown; command?: unknown; timestamp?: unknown } | undefined;
	if (data?.shellId == null) return;
	const command = String(data.command ?? "");
	out.push({
		...row(entry.id, "shell", command, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)),
		command: {
			commandId: String(data.shellId),
			name: command,
			status: "running",
		},
	});
}

function shellDoneVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { shellId?: unknown; kind?: unknown; text?: unknown } | undefined;
	if (data?.shellId == null) return;
	const item = findLast(out, (r) => r.kind === "shell" && r.command?.commandId === String(data.shellId));
	if (item?.kind !== "shell" || !item.command) return;
	item.command.status = data.kind === "error" ? "error" : "success";
	if (typeof data.text === "string") item.command.text = data.text;
}

function rewindVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { targetId?: unknown; text?: unknown; shadowedIds?: unknown } | undefined;
	if (data?.targetId == null || typeof data.text !== "string") return;
	const targetId = String(data.targetId);
	const item = findLast(out, (r) => r.kind === "user" && r.id === targetId);
	if (item?.kind === "user") item.text = data.text;
	if (Array.isArray(data.shadowedIds)) {
		const shadowed = new Set(data.shadowedIds.filter((id): id is string => typeof id === "string"));
		for (let i = out.length - 1; i >= 0; i--) {
			if (shadowed.has(out[i].id)) out.splice(i, 1);
		}
	}
}

// ——— slice projection ———

function messageProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "message") return null;
	return entry.message as unknown as AgentMessage;
}

function isAutoDelivered(entry: Entry): boolean {
	if (entry.type !== "custom") return false;
	const data = (entry.data ?? {}) as { toolCallId?: unknown };
	return data.toolCallId === "harness-delivery";
}

function sendMessageProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "custom") return null;
	if (isAutoDelivered(entry)) return null;
	const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
	return {
		role: "custom",
		customType: "send_message",
		content: typeof data.text === "string" ? data.text : "",
		display: true,
		timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
	} as AgentMessage;
}

function toolResultProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "custom") return null;
	const data = (entry.data ?? {}) as {
		toolCallId?: unknown;
		toolName?: unknown;
		content?: unknown;
		details?: unknown;
		usage?: unknown;
		addedToolNames?: unknown;
		isError?: unknown;
		timestamp?: unknown;
	};
	return {
		role: "toolResult",
		toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : "",
		toolName: typeof data.toolName === "string" ? data.toolName : "",
		content: Array.isArray(data.content) ? data.content : [],
		details: data.details,
		usage: data.usage as ToolResultMessage["usage"] | undefined,
		...(Array.isArray(data.addedToolNames) ? { addedToolNames: data.addedToolNames } : {}),
		isError: data.isError === true,
		timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
	} as unknown as AgentMessage;
}

function textUserProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "custom") return null;
	const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
	return {
		role: "user",
		content: typeof data.text === "string" ? data.text : "",
		timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
	} as AgentMessage;
}

function mcpChangedProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "custom") return null;
	const data = (entry.data ?? {}) as { server?: unknown; change?: unknown; granted?: unknown; timestamp?: unknown };
	return {
		role: "user",
		content: mcpChangedText({
			server: typeof data.server === "string" ? data.server : "",
			change: data.change === "removed" ? "removed" : "added",
			granted: Array.isArray(data.granted) ? data.granted.filter((s): s is string => typeof s === "string") : [],
		}),
		timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
	} as AgentMessage;
}

function instructionsChangedProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "custom") return null;
	const data = (entry.data ?? {}) as { agentMd?: unknown; timestamp?: unknown };
	return {
		role: "user",
		content: instructionsChangedText(typeof data.agentMd === "string" ? data.agentMd : null),
		timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
	} as AgentMessage;
}

function contextChangedProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "custom") return null;
	const data = (entry.data ?? {}) as { workspace?: unknown; storage?: unknown; sandbox?: unknown; skills?: unknown; timestamp?: unknown };
	return {
		role: "user",
		content: contextChangedText({
			workspace: typeof data.workspace === "string" ? data.workspace : null,
			storage: typeof data.storage === "string" ? data.storage : null,
			sandbox: (data.sandbox ?? "workspace-write") as SandboxMode,
			skills: Array.isArray(data.skills) ? (data.skills as { name: string; description: string; digest: string }[]) : [],
		}),
		timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
	} as AgentMessage;
}

function memoryContextProject(entry: Entry): AgentMessage | null {
	if (entry.type !== "custom") return null;
	const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
	if (typeof data.text !== "string" || data.text.length === 0) return null;
	return {
		role: "user",
		content: data.text,
		timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
	} as AgentMessage;
}

function pushProject(project: (entry: Entry) => AgentMessage | null): NonNullable<ContextMeta["visit"]> {
	return (ctx) => {
		const msg = project(ctx.entry);
		if (msg) ctx.out.push({ id: ctx.entry.id, message: msg });
	};
}

const messageVisit = pushProject(messageProject);
const sendMessageSliceVisit = pushProject(sendMessageProject);
const textUserVisit = pushProject(textUserProject);
const mcpChangedVisit = pushProject(mcpChangedProject);
const instructionsChangedVisit = pushProject(instructionsChangedProject);
const contextChangedVisit = pushProject(contextChangedProject);
const memoryContextVisit = pushProject(memoryContextProject);

function assistantToolCallIds(entry: Entry): string[] {
	if (entry.type !== "message" || entry.message.role !== "assistant") return [];
	const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
	return blocks.filter((b) => (b as { type?: unknown }).type === "toolCall").map((b) => String((b as { id?: unknown }).id ?? ""));
}

function sliceAssistant(ctx: SliceContext): void {
	const ids = assistantToolCallIds(ctx.entry);
	if (ids.length === 0) {
		messageVisit(ctx);
		return;
	}
	const firstId = ids[0];
	const hasResult = ctx.entries
		.slice(ctx.index + 1)
		.some((e) => e.type === "custom" && e.customType === EVENTS.toolResult && (e.data as { toolCallId?: unknown }).toolCallId === firstId);
	if (hasResult || ctx.keepDangling) messageVisit(ctx);
}

function sliceToolResult(ctx: SliceContext): void {
	const msg = toolResultProject(ctx.entry);
	if (!msg) return;
	const item: SliceItem = { id: ctx.entry.id, message: msg };
	const callId = String((msg as unknown as { toolCallId?: unknown }).toolCallId ?? "");
	let owner = -1;
	for (let i = ctx.out.length - 1; i >= 0; i--) {
		const prev = ctx.out[i].message;
		if (prev.role !== "assistant") continue;
		const blocks = Array.isArray(prev.content) ? prev.content : [];
		const ids = blocks.filter((b) => (b as { type?: unknown }).type === "toolCall").map((b) => String((b as { id?: unknown }).id ?? ""));
		if (ids.includes(callId)) {
			owner = i;
			break;
		}
	}
	if (owner < 0) {
		ctx.out.push(item);
		return;
	}
	let k = owner;
	while (k + 1 < ctx.out.length && ctx.out[k + 1].message.role === "toolResult") k++;
	ctx.out.splice(k + 1, 0, item);
}

function sliceCompaction(ctx: SliceContext): void {
	if (ctx.entry.type !== "custom" || ctx.entry.customType !== EVENTS.compaction) return;
	const d = (ctx.entry.data ?? {}) as CompactionEventData;
	const checkpoint: SliceItem = {
		id: ctx.entry.id,
		message: { role: "user", content: d.summary, timestamp: d.timestamp ?? ctx.entry.timestamp ?? 0 } as AgentMessage,
	};
	const shadowed = Array.isArray(d.shadowedIds) ? new Set(d.shadowedIds) : null;
	if (!shadowed) {
		ctx.out.length = 0;
		ctx.out.push(checkpoint);
		return;
	}
	const kept = ctx.out.filter((item) => !shadowed.has(item.id));
	ctx.out.length = 0;
	ctx.out.push(checkpoint, ...kept);
}

function sliceRewind(ctx: SliceContext): void {
	if (ctx.entry.type !== "custom" || ctx.entry.customType !== EVENTS.rewind) return;
	const d = (ctx.entry.data ?? {}) as RewindEventData;
	const shadowed = new Set(d.shadowedIds ?? []);
	for (let i = ctx.out.length - 1; i >= 0; i--) {
		if (shadowed.has(ctx.out[i].id)) ctx.out.splice(i, 1);
	}
	const targetIndex = ctx.out.findIndex((item) => item.id === d.targetId && item.message.role === "user");
	if (targetIndex >= 0) {
		const target = ctx.out[targetIndex];
		ctx.out[targetIndex] = { ...target, message: { ...(target.message as object), content: d.text } as AgentMessage };
	}
}

// ——— origin handlers ———

function requestHeaderOriginVisit(entry: Entry, out: Entry[]): void {
	if (entry.type !== "custom") return;
	if (out.some((prev) => prev.type === "custom" && prev.customType === EVENTS.requestHeader)) return;
	out.push(entry);
}

// ——— trajectory nodes ———

const firstLine = (value: string): string => value.split("\n").find((line) => line.trim()) ?? "";

function recordField(record: TrajectoryRecord, path: string): unknown {
	let value: unknown = record;
	for (const key of path.split(".")) {
		if (value === null || typeof value !== "object") return undefined;
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}

const recordText = (record: TrajectoryRecord, path: string): string => {
	const value = recordField(record, path);
	return typeof value === "string" ? value : "";
};

const recordNumber = (record: TrajectoryRecord, path: string): number | undefined => {
	const value = recordField(record, path);
	return typeof value === "number" ? value : undefined;
};

const recordBody = (record: TrajectoryRecord): string => (record.kind === "user" ? record.content : recordText(record, "data.text"));

const recordData = (record: TrajectoryRecord): Record<string, unknown> => {
	const data = recordField(record, "data");
	return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
};

const asSliceUser = (record: TrajectoryRecord, content: string): TrajectoryRecord => ({ ...record, kind: "user", content }) as TrajectoryRecord;

const asProjected = (record: TrajectoryRecord, project: (entry: Entry) => AgentMessage | null): TrajectoryRecord => {
	const entry = {
		type: "custom",
		customType: (record as { customType?: string }).customType ?? "",
		data: recordData(record),
		id: record.entryId,
		timestamp: record.time,
	} as unknown as Entry;
	const message = project(entry);
	if (message === null) return record;
	const content = (message as { content?: unknown }).content;
	return asSliceUser(record, typeof content === "string" ? content : "");
};

// ——— entry → data ———

const userData = (entry: Entry): EntryPayload | null => {
	if (entry.type !== "message" || entry.message.role !== "user") return null;
	const m = entry.message;
	const skill = (m as { skill?: unknown }).skill;
	return { kind: "user", content: typeof m.content === "string" ? m.content : contentText(m.content), ...(typeof skill === "string" ? { skillName: skill } : {}) };
};

const assistantData = (entry: Entry): EntryPayload | null => {
	if (entry.type !== "message" || entry.message.role !== "assistant") return null;
	const m = entry.message;
	return {
		kind: "assistant",
		blocks: (m.content as unknown as TrajectoryBlock[]) ?? [],
		api: m.api,
		provider: m.provider,
		model: m.model,
		responseModel: m.responseModel,
		responseId: m.responseId,
		timing: (m as { timing?: { turnStartTime: number; firstTokenTime: number | null; completedTime: number } }).timing,
		usage: toTrajectoryUsage(m.usage),
		stopReason: m.stopReason,
		errorMessage: m.errorMessage,
		rawStopReason: m.rawStopReason,
	};
};

const toolResultData = (entry: Entry): EntryPayload | null => {
	if (entry.type !== "custom" || entry.customType !== EVENTS.toolResult) return null;
	const data = (entry.data ?? {}) as {
		toolCallId?: unknown;
		toolName?: unknown;
		content?: unknown;
		details?: unknown;
		usage?: unknown;
		addedToolNames?: unknown;
		isError?: unknown;
	};
	return {
		kind: "toolResult",
		toolCallId: String(data.toolCallId ?? ""),
		toolName: String(data.toolName ?? ""),
		content: contentText(data.content),
		details: data.details,
		usage: toTrajectoryUsage(data.usage as RawUsage | undefined),
		addedToolNames: Array.isArray(data.addedToolNames) ? data.addedToolNames.map(String) : undefined,
		isError: data.isError === true,
	};
};

const modelChangeData = (entry: Entry): EntryPayload | null => (entry.type === "model_change" ? { kind: "modelChange", provider: entry.provider, modelId: entry.modelId } : null);

const activeToolsData = (entry: Entry): EntryPayload | null => (entry.type === "active_tools_change" ? { kind: "activeTools", activeToolNames: entry.activeToolNames } : null);

const compactionData = (entry: Entry): EntryPayload | null =>
	entry.type === "compaction"
		? {
				kind: "compaction",
				summary: entry.summary,
				retainedTailCount: entry.retainedTail.length,
				tokensBefore: entry.tokensBefore,
				details: entry.details,
				usage: toTrajectoryUsage(entry.usage),
			}
		: null;

const branchSummaryData = (entry: Entry): EntryPayload | null =>
	entry.type === "branch_summary" ? { kind: "branchSummary", fromId: entry.fromId, summary: entry.summary, details: entry.details, usage: toTrajectoryUsage(entry.usage) } : null;

const agentStartCursor = (state: Cursor, entry: Entry): void => {
	state.run = eventNumber(entry, "run", state.run + 1);
	state.turn = 0;
	state.open = true;
};

const turnStartCursor = (state: Cursor, entry: Entry): void => {
	state.turn = eventNumber(entry, "turn", state.turn + 1);
};

export function stringifyArgs(args: unknown): string {
	if (typeof args === "string") return args;
	if (args == null) return "";
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

const fmtTok = (value: number | undefined): string => (value && value > 0 ? value.toLocaleString() : "—");

export function formatUsage(usage: TrajectoryUsage | undefined): string | undefined {
	if (!usage) return undefined;
	const reasoning = usage.reasoning ? ` · reasoning ${fmtTok(usage.reasoning)}` : "";
	return `in ${fmtTok(usage.input)} · out ${fmtTok(usage.output)} · cacheRead ${fmtTok(usage.cacheRead)} · cacheWrite ${fmtTok(usage.cacheWrite)}${reasoning} tok`;
}

const textDetail = (value: string): TrajectoryDetail => ({ content: { kind: "text", value } });
const codeDetail = (value: string, error?: boolean): TrajectoryDetail => ({ content: { kind: "code", value }, ...(error ? { error: true } : {}) });
const jsonDetail = (value: unknown): TrajectoryDetail => {
	let text: string;
	try {
		text = JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		text = String(value);
	}
	return { content: { kind: "json", value: text } };
};
const metaDetail = (...facts: (string | undefined)[]): TrajectoryDetail => ({ meta: facts.filter((fact): fact is string => fact !== undefined && fact !== "") });

export function defaultChip(metaKey: string): string {
	const segment = metaKey.split(/[:/_-]/).find((part) => part !== "") ?? metaKey;
	return segment
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 3)
		.toUpperCase();
}

export function trajectoryNode(record: TrajectoryRecord): TrajectoryNode & { chip: string; tone: TrajectoryTone; caption: string; details: TrajectoryDetail[] } {
	const node = EVENT_META[record.metaKey]?.trajectory?.(record) ?? { details: [jsonDetail(record.kind === "custom" ? record.data : record)] };
	return { ...node, chip: node.chip ?? defaultChip(record.metaKey), tone: node.tone ?? "custom", caption: node.caption ?? record.metaKey, details: node.details ?? [] };
}

function dataNode(
	tone: TrajectoryTone,
	options: { chip?: string; caption?: (record: TrajectoryRecord) => string; details?: (record: TrajectoryRecord) => TrajectoryDetail[] } = {},
): EntryMeta {
	return {
		trajectory: (record) => ({
			chip: options.chip,
			tone,
			caption: options.caption?.(record),
			details: options.details?.(record) ?? [record.kind === "user" ? textDetail(record.content) : jsonDetail(recordField(record, "data"))],
		}),
	};
}

function assistantNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "assistant") return {};
	const rows: TrajectoryRow[] = [];
	for (const block of record.blocks) {
		if (block.type !== "thinking") continue;
		const thinking = String(block.thinking ?? "");
		rows.push({ chip: "THINK", tone: "plain", caption: firstLine(thinking), details: [textDetail(thinking)] });
	}
	if (record.sliceMessage !== undefined) {
		for (const block of record.blocks) {
			if (block.type !== "toolCall") continue;
			const name = String(block.name ?? "");
			const args = stringifyArgs(block.arguments).replace(/\s+/g, " ").trim();
			rows.push({
				chip: "TOOL",
				tone: "plain",
				caption: args ? `${name} · ${args}` : name,
				details: [{ label: name, description: String(block.id ?? "") }, { content: { kind: "code", value: stringifyArgs(block.arguments) } }],
			});
		}
	}
	const texts = record.blocks.filter((block) => block.type === "text").map((block) => String(block.text ?? ""));
	const others = record.blocks.filter((block) => block.type !== "text" && block.type !== "toolCall" && block.type !== "thinking");
	const caption = firstLine(texts.join("\n")) || record.blocks.find((block) => block.type === "toolCall")?.name?.toString() || "assistant";
	rows.push({
		chip: "MSG",
		tone: "plain",
		caption: firstLine(texts.join("\n")) || "assistant",
		details: [
			...texts.map((value) => textDetail(value)),
			...others.map((block) => jsonDetail(block)),
			metaDetail(
				record.model,
				`${record.provider} · ${record.api}`,
				`stop: ${record.stopReason}`,
				record.responseModel && `responseModel ${record.responseModel}`,
				record.responseId && `response ${record.responseId}`,
				formatUsage(record.usage),
			),
			...(record.errorMessage ? [{ meta: [record.errorMessage], error: true }] : []),
		],
	});
	return { chip: "MSG", tone: "plain", caption, rows };
}

function toolResultNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "toolResult") return {};
	return {
		chip: "RES",
		tone: "result",
		caption: firstLine(record.content) || record.toolName,
		details: [
			codeDetail(record.content || "(no output)", record.isError),
			metaDetail(
				`call ${record.toolCallId}`,
				record.toolName,
				record.isError ? "error" : "ok",
				record.addedToolNames?.length ? `tools added: ${record.addedToolNames.join(", ")}` : undefined,
				formatUsage(record.usage),
			),
			...(record.details != null ? [jsonDetail(record.details)] : []),
		],
	};
}

function toolCallNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "custom") return {};
	const name = recordText(record, "data.name");
	const args = stringifyArgs(recordField(record, "data.args")).replace(/\s+/g, " ").trim();
	return {
		chip: "TOOL",
		tone: "plain",
		caption: args ? `${name} · ${args}` : name,
		details: [{ label: name, description: recordText(record, "data.callId") }, { content: { kind: "code", value: stringifyArgs(recordField(record, "data.args")) } }],
	};
}

function modelChangeNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind === "modelChange")
		return { chip: "MOD", tone: "change", caption: `${record.provider} → ${record.modelId}`, details: [metaDetail(record.provider, `→ ${record.modelId}`)] };
	return { tone: "change", details: [jsonDetail(recordField(record, "data"))] };
}

function compactionNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "compaction") return { tone: "compact", details: [jsonDetail(recordField(record, "data"))] };
	return {
		chip: "CMP",
		tone: "compact",
		caption: firstLine(record.summary) || "compaction",
		details: [
			textDetail(record.summary || "(empty summary)"),
			metaDetail(`${fmtTok(record.tokensBefore)} tok before`, `${record.retainedTailCount} retained messages`, formatUsage(record.usage)),
			...(record.details != null ? [jsonDetail(record.details)] : []),
		],
	};
}

function branchSummaryNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "branchSummary") return {};
	return {
		chip: "BR",
		tone: "compact",
		caption: firstLine(record.summary) || "branch summary",
		details: [
			textDetail(record.summary || "(empty summary)"),
			metaDetail(`from ${record.fromId}`, formatUsage(record.usage)),
			...(record.details != null ? [jsonDetail(record.details)] : []),
		],
	};
}

function activeToolsNode(record: TrajectoryRecord): TrajectoryNode {
	if (record.kind !== "activeTools") return {};
	return { chip: "TOOLS", tone: "change", caption: record.activeToolNames.join(", "), details: record.activeToolNames.map((name) => ({ label: name })) };
}

function requestHeaderNode(record: TrajectoryRecord): TrajectoryNode {
	const tools = Array.isArray(recordField(record, "data.tools"))
		? (recordField(record, "data.tools") as { name?: unknown; label?: unknown; description?: unknown; parameters?: unknown }[])
		: [];
	const details: TrajectoryDetail[] = tools
		.filter((tool) => tool !== null && typeof tool === "object")
		.map((tool) => ({
			label: String(tool.name ?? ""),
			description: tool.description === undefined ? undefined : String(tool.description),
			meta: tool.label === undefined ? [] : [String(tool.label)],
			content: { kind: "json", value: stringifyArgs(tool.parameters) },
		}));
	const names = Array.isArray(recordField(record, "data.toolNames")) ? (recordField(record, "data.toolNames") as unknown[]).map(String) : [];
	const caption = names.length > 0 ? `${names.join(", ")} · ${names.length} tool${names.length === 1 ? "" : "s"}` : "request header";
	return { chip: "HDR", tone: "request", caption, details: details.length > 0 ? details : names.map((name) => ({ label: name })) };
}

function escalationRequestNode(record: TrajectoryRecord): TrajectoryNode {
	const id = recordText(record, "data.escalationId");
	const command = recordText(record, "data.command");
	return {
		chip: "ESC",
		tone: "request",
		caption: firstLine(command),
		details: [
			metaDetail("escalation", id),
			codeDetail(command),
			metaDetail(`${recordText(record, "data.from")} → ${recordText(record, "data.to")}`, recordText(record, "data.justification")),
		],
	};
}

function escalationDecisionNode(record: TrajectoryRecord): TrajectoryNode {
	const approved = recordField(record, "data.approved") === true;
	const id = recordText(record, "data.escalationId");
	return { chip: "DEC", tone: "decision", caption: approved ? "approved" : "rejected", details: [metaDetail(approved ? "approved" : "rejected", id)] };
}

function agentEndNode(record: TrajectoryRecord): TrajectoryNode {
	const reason = recordText(record, "data.reason") || "completed";
	const error = recordText(record, "data.error");
	return {
		chip: "END",
		tone: "plain",
		caption: error ? `${reason} · ${error}` : reason,
		details: [metaDetail(`run ${recordNumber(record, "data.run") ?? "?"}`, reason), ...(error ? [{ meta: [error], error: true }] : [])],
	};
}

// ——— event registry ———

export const EVENT_META: Record<string, EntryMeta> = {
	"role:user": {
		view: { visit: userVisit },
		context: { visit: messageVisit },
		data: userData,
		trajectory: (record) =>
			record.kind !== "user"
				? {}
				: {
						chip: record.skillName ? "SKILL" : "Q",
						tone: record.skillName ? "skill" : "user",
						caption: firstLine(record.content),
						details: [textDetail(record.content)],
					},
	},
	"role:assistant": {
		view: { visit: assistantVisit },
		context: { visit: sliceAssistant },
		data: assistantData,
		trajectory: assistantNode,
	},
	[EVENTS.modelChange]: { data: modelChangeData, trajectory: modelChangeNode },
	[EVENTS.compaction]: { context: { visit: sliceCompaction }, data: compactionData, trajectory: compactionNode },
	active_tools_change: { data: activeToolsData, trajectory: activeToolsNode },
	branch_summary: { data: branchSummaryData, trajectory: branchSummaryNode },

	[EVENTS.sendMessage]: {
		view: { visit: sendMessageVisit },
		context: { visit: sendMessageSliceVisit },
		trajectory: (record) => ({ chip: "SEND", tone: "message", caption: firstLine(recordText(record, "data.text")), details: [textDetail(recordText(record, "data.text"))] }),
	},
	[EVENTS.agentEnd]: { view: { visit: agentEndVisit }, close: true, trajectory: agentEndNode },
	[EVENTS.escalationRequest]: { view: { visit: escalationVisit }, trajectory: escalationRequestNode },
	[EVENTS.escalationDecision]: { view: { visit: escalationDecisionVisit }, trajectory: escalationDecisionNode },

	[EVENTS.commandRun]: { view: { visit: commandVisit }, ...dataNode("custom", { chip: "CMD", caption: (record) => firstLine(recordText(record, "data.command")) }) },
	[EVENTS.commandDone]: { view: { visit: commandDoneVisit }, ...dataNode("custom", { chip: "CMD", caption: (record) => recordText(record, "data.kind") }) },
	[EVENTS.skillRun]: { view: { visit: skillVisit }, ...dataNode("skill", { chip: "SKILL", caption: (record) => recordText(record, "data.name") }) },
	[EVENTS.skillDone]: { view: { visit: skillDoneVisit }, ...dataNode("skill", { chip: "SKILL", caption: (record) => recordText(record, "data.kind") }) },
	[EVENTS.shellRun]: { view: { visit: shellVisit }, ...dataNode("custom", { chip: "SHLL", caption: (record) => firstLine(recordText(record, "data.command")) }) },
	[EVENTS.shellDone]: { view: { visit: shellDoneVisit }, ...dataNode("custom", { chip: "SHLL", caption: (record) => recordText(record, "data.kind") }) },
	[EVENTS.memoryRunStart]: dataNode("custom", { chip: "MEM", caption: (record) => recordText(record, "data.stage") }),
	[EVENTS.memoryRunEnd]: dataNode("custom", { chip: "MEM", caption: (record) => recordText(record, "data.reason") }),
	[EVENTS.memoryContext]: { context: { visit: memoryContextVisit }, slice: { as: (record) => asProjected(record, memoryContextProject) }, ...dataNode("custom", { chip: "MEM" }) },

	[EVENTS.toolResult]: { view: { visit: toolResultVisit }, context: { visit: sliceToolResult }, data: toolResultData, trajectory: toolResultNode },
	[EVENTS.toolCall]: { trajectory: toolCallNode },
	[EVENTS.agentStart]: { ...dataNode("change", { chip: "RUN", caption: (record) => `run ${recordNumber(record, "data.run") ?? "?"}` }), cursor: agentStartCursor },
	[EVENTS.turnStart]: {
		hidden: true,
		cursor: turnStartCursor,
		trajectory: (record) => ({ chip: "TURN", tone: "plain", caption: `turn ${recordNumber(record, "data.turn") ?? 0}` }),
	},
	[EVENTS.turnEnd]: { hidden: true, ...dataNode("plain", { chip: "TURN", caption: (record) => `turn ${recordNumber(record, "data.turn") ?? "?"} end` }) },
	[EVENTS.requestHeader]: { origin: { visit: requestHeaderOriginVisit }, pin: "system_prompt", trajectory: requestHeaderNode },
	[EVENTS.systemPrompt]: {
		dedupe: true,
		trajectory: (record) => ({ chip: "SYS", tone: "system", caption: "System prompt", details: [codeDetail(recordText(record, "data.text"))] }),
	},
	[EVENTS.timeGapReminder]: {
		context: { visit: textUserVisit },
		slice: { as: (record) => asProjected(record, textUserProject) },
		trajectory: (record) => ({ chip: "GAP", tone: "reminder", caption: firstLine(recordBody(record)), details: [textDetail(recordBody(record))] }),
	},
	[EVENTS.contextChanged]: {
		context: { visit: contextChangedVisit },
		slice: { as: (record) => asProjected(record, contextChangedProject) },
		...dataNode("reminder", { chip: "CTX" }),
	},
	[EVENTS.instructionsChanged]: {
		context: { visit: instructionsChangedVisit },
		slice: { as: (record) => asProjected(record, instructionsChangedProject) },
		...dataNode("reminder", { chip: "INS" }),
	},
	[EVENTS.mcpChanged]: { context: { visit: mcpChangedVisit }, slice: { as: (record) => asProjected(record, mcpChangedProject) }, ...dataNode("reminder", { chip: "MCP" }) },
	[EVENTS.rewind]: { view: { visit: rewindVisit }, context: { visit: sliceRewind }, ...dataNode("custom", { chip: "RWD" }) },
	[EVENTS.compactionSummary]: {
		context: { visit: textUserVisit },
		slice: { as: (record) => asProjected(record, textUserProject) },
		trajectory: (record) => ({ chip: "SUM", tone: "compact", caption: firstLine(recordBody(record)), details: [codeDetail(recordBody(record))] }),
	},
	[EVENTS.compactionStart]: dataNode("compact", { chip: "START", caption: () => "compaction start" }),
	[EVENTS.compactionEnd]: dataNode("compact", { chip: "END", caption: () => "compaction end" }),
	[EVENTS.compactionPrune]: dataNode("compact", { chip: "PRN" }),
	[EVENTS.retryScheduled]: dataNode("change", { chip: "RET", caption: (record) => `retry #${recordNumber(record, "data.retry") ?? "?"}` }),
	[EVENTS.retryStarted]: dataNode("change", { chip: "RET", caption: (record) => `retry #${recordNumber(record, "data.retry") ?? "?"}` }),
};

// ——— public projection ———

export function entryKey(entry: Entry): string {
	if (entry.type === "message") return `role:${entry.message.role}`;
	if (entry.type === "custom") return entry.customType;
	return entry.type;
}

export interface ProjectViewOptions {
	baseDir?: string | null;
}

export function projectView(entries: Entry[], options: ProjectViewOptions = {}): ViewItem[] {
	const out: ViewItem[] = [];
	for (const entry of entries) {
		EVENT_META[entryKey(entry)]?.view?.visit?.(entry, out);
	}
	markProcessText(entries, out);
	attachPeerPosts(entries, out);
	attachMentionFiles(entries, out, options.baseDir ?? null);
	return out;
}

export interface ProjectSliceOptions {
	keepDangling?: boolean;
}

export function projectSliceItems(entries: Entry[], options: ProjectSliceOptions = {}): SliceItem[] {
	const out: SliceItem[] = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		EVENT_META[entryKey(entry)]?.context?.visit?.({
			entry,
			index: i,
			entries,
			out,
			keepDangling: options.keepDangling ?? false,
		});
	}
	return out;
}

export function projectSlice(entries: Entry[], options: ProjectSliceOptions = {}): AgentMessage[] {
	return projectSliceItems(entries, options).map((item) => item.message);
}
