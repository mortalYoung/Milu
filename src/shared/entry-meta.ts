import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { type CompactionEventData, contextChangedText, EVENTS, instructionsChangedText, mcpChangedText, type RewindEventData } from "./events";
import { attachMentionFiles } from "./file-mentions";
import type { SandboxMode, ViewItem } from "./rpc";

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

export interface SliceMeta {
	visit?(ctx: SliceContext): void;
}

export interface OriginMeta {
	visit?(entry: Entry, out: Entry[]): void;
}

export interface TrajectoryMeta {
	label: string;
}

export interface EntryMeta {
	origin?: OriginMeta;
	view?: ViewMeta;
	slice?: SliceMeta;
	trajectory?: TrajectoryMeta;
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
	const skill = (entry.message as { skill?: unknown }).skill;
	const text = typeof content === "string" ? content : "";
	out.push({
		...row(entry.id, "user", text, entry.message.timestamp ?? entry.timestamp ?? 0),
		...(typeof skill === "string" ? { skillName: skill } : {}),
	});
}

function sendMessageVisit(entry: Entry, out: ViewItem[]): void {
	if (entry.type !== "custom") return;
	const data = entry.data as { text?: unknown; timestamp?: unknown; toolCallId?: unknown } | undefined;
	if (!data || typeof data.text !== "string") return;
	if (typeof data.toolCallId === "string" && data.toolCallId.startsWith("shell:")) return;
	out.push(row(entry.id, "send_message", data.text, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)));
}

function turnEndVisit(entry: Entry, out: ViewItem[]): void {
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

function pushProject(project: (entry: Entry) => AgentMessage | null): NonNullable<SliceMeta["visit"]> {
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

// ——— event registry ———

export const EVENT_META: Record<string, EntryMeta> = {
	"role:user": { view: { visit: userVisit }, slice: { visit: messageVisit } },
	"role:assistant": {
		view: {},
		slice: { visit: sliceAssistant },
	},

	[EVENTS.sendMessage]: { view: { visit: sendMessageVisit }, slice: { visit: sendMessageSliceVisit } },
	[EVENTS.turnEnd]: { view: { visit: turnEndVisit } },
	[EVENTS.escalationRequest]: { view: { visit: escalationVisit } },
	[EVENTS.commandRun]: { view: { visit: commandVisit } },
	[EVENTS.skillRun]: { view: { visit: skillVisit } },
	[EVENTS.shellRun]: { view: { visit: shellVisit } },

	[EVENTS.commandDone]: { view: { visit: commandDoneVisit } },
	[EVENTS.skillDone]: { view: { visit: skillDoneVisit } },
	[EVENTS.shellDone]: { view: { visit: shellDoneVisit } },
	[EVENTS.escalationDecision]: { view: { visit: escalationDecisionVisit } },
	[EVENTS.memoryRunStart]: {},
	[EVENTS.memoryRunEnd]: {},

	[EVENTS.toolResult]: { slice: { visit: sliceToolResult } },
	[EVENTS.timeGapReminder]: { slice: { visit: textUserVisit } },
	[EVENTS.contextChanged]: { slice: { visit: contextChangedVisit } },
	[EVENTS.memoryContext]: { slice: { visit: memoryContextVisit } },
	[EVENTS.instructionsChanged]: { slice: { visit: instructionsChangedVisit } },
	[EVENTS.mcpChanged]: { slice: { visit: mcpChangedVisit } },
	[EVENTS.rewind]: { view: { visit: rewindVisit }, slice: { visit: sliceRewind } },

	[EVENTS.compaction]: { slice: { visit: sliceCompaction } },
	[EVENTS.compactionSummary]: { slice: { visit: textUserVisit } },

	[EVENTS.turnStart]: {},
	[EVENTS.stepStart]: {},
	[EVENTS.stepEnd]: {},
	[EVENTS.toolCall]: {},
	[EVENTS.requestHeader]: { origin: { visit: requestHeaderOriginVisit } },
	[EVENTS.systemPrompt]: {},
	[EVENTS.followUp]: {},
	[EVENTS.compactionStart]: {},
	[EVENTS.compactionEnd]: {},
	[EVENTS.compactionPrune]: {},
	[EVENTS.modelChange]: {},
	[EVENTS.retryScheduled]: {},
	[EVENTS.retryStarted]: {},
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
		EVENT_META[entryKey(entry)]?.slice?.visit?.({
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
