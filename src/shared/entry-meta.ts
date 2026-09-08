import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { contextChangedText, EVENTS, instructionsChangedText, mcpChangedText } from "./events";
import type { SandboxMode, ViewItem } from "./rpc";
import type { SurfaceNode } from "./surface";

export interface ViewProjectionContext {
	commandDones: Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>;
	skillDones: Map<string, { kind: "success" | "error"; text?: string }>;
	shellDones: Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>;
	escalationDecisions: Map<string, { kind: "approved" | "rejected" | "dropped" }>;
	editedUserText: Map<string, string>;
	rewoundIds: Set<string>;
}

export interface ViewMeta {
	project(entry: Entry, ctx: ViewProjectionContext): ViewItem[];
}

export interface SliceMeta {
	node?: SurfaceNode["kind"] | ((entry: Entry) => SurfaceNode["kind"] | null);
	project?(entry: Entry): AgentMessage | null;
}

export interface TrajectoryMeta {
	label: string;
}

export interface EntryMeta {
	view?: ViewMeta;
	slice?: SliceMeta;
	trajectory?: TrajectoryMeta;
}

type CustomEntryOf<E extends Entry> = Extract<E, { type: "custom" }>;

const row = (id: string, kind: ViewItem["kind"], text: string, time: number): ViewItem => ({ id, kind, text, time });

function userRow(entry: Entry, ctx: ViewProjectionContext): ViewItem[] {
	if (entry.type !== "message" || entry.message.role !== "user") return [];
	const content = entry.message.content;
	const skill = (entry.message as { skill?: unknown }).skill;
	const text = typeof content === "string" ? (ctx.editedUserText.get(entry.id) ?? content) : "";
	return [
		{
			...row(entry.id, "user", text, entry.message.timestamp ?? entry.timestamp ?? 0),
			...(typeof skill === "string" ? { skillName: skill } : {}),
		},
	];
}

function sendMessageRow(entry: Entry): ViewItem[] {
	if (entry.type !== "custom") return [];
	const data = entry.data as { text?: unknown; timestamp?: unknown; toolCallId?: unknown } | undefined;
	if (!data || typeof data.text !== "string") return [];
	if (typeof data.toolCallId === "string" && data.toolCallId.startsWith("shell:")) return [];
	return [row(entry.id, "send_message", data.text, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0))];
}

function turnEndRow(entry: Entry): ViewItem[] {
	if (entry.type !== "custom") return [];
	const data = entry.data as { reason?: unknown; error?: unknown; timestamp?: unknown } | undefined;
	const time = typeof data?.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0);
	if (data?.reason === "aborted") return [row(entry.id, "aborted", "stopped", time)];
	if (data?.reason === "error" && typeof data.error === "string") return [row(entry.id, "error", data.error, time)];
	return [];
}

function escalationRow(entry: Entry, ctx: ViewProjectionContext): ViewItem[] {
	if (entry.type !== "custom") return [];
	const data = entry.data as { escalationId?: unknown; command?: unknown; from?: unknown; to?: unknown; justification?: unknown; timestamp?: unknown } | undefined;
	if (data?.escalationId == null) return [];
	const decision = ctx.escalationDecisions.get(String(data.escalationId));
	return [
		{
			...row(entry.id, "escalation", String(data.command ?? ""), typeof data.timestamp === "number" ? data.timestamp : 0),
			escalation: {
				id: String(data.escalationId),
				command: String(data.command ?? ""),
				from: data.from as SandboxMode,
				to: data.to as SandboxMode,
				justification: String(data.justification ?? ""),
				status: decision?.kind ?? "pending",
			},
		},
	];
}

function commandRow(entry: Entry, ctx: ViewProjectionContext): ViewItem[] {
	if (entry.type !== "custom") return [];
	const data = entry.data as { commandId?: unknown; name?: unknown; args?: unknown; timestamp?: unknown } | undefined;
	if (data?.commandId == null) return [];
	const done = ctx.commandDones.get(String(data.commandId));
	const name = String(data.name ?? "");
	return [
		{
			...row(entry.id, "command", name, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)),
			command: {
				commandId: String(data.commandId),
				name,
				...(typeof data.args === "string" ? { args: data.args } : {}),
				status: done ? done.kind : "running",
				...(done?.text ? { text: done.text } : {}),
			},
		},
	];
}

function skillRow(entry: Entry, ctx: ViewProjectionContext): ViewItem[] {
	if (entry.type !== "custom") return [];
	const data = entry.data as { skillId?: unknown; name?: unknown; hint?: unknown; timestamp?: unknown } | undefined;
	if (data?.skillId == null) return [];
	const done = ctx.skillDones.get(String(data.skillId));
	const name = String(data.name ?? "");
	return [
		{
			...row(entry.id, "skill", name, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)),
			skill: {
				commandId: String(data.skillId),
				name,
				...(typeof data.hint === "string" && data.hint ? { args: data.hint } : {}),
				status: done ? done.kind : "running",
			},
		},
	];
}

function shellRow(entry: Entry, ctx: ViewProjectionContext): ViewItem[] {
	if (entry.type !== "custom") return [];
	const data = entry.data as { shellId?: unknown; command?: unknown; timestamp?: unknown } | undefined;
	if (data?.shellId == null) return [];
	const done = ctx.shellDones.get(String(data.shellId));
	const command = String(data.command ?? "");
	return [
		{
			...row(entry.id, "shell", command, typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0)),
			command: {
				commandId: String(data.shellId),
				name: command,
				status: done ? done.kind : "running",
				...(done?.text ? { text: done.text } : {}),
			},
		},
	];
}

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

function sendMessageNode(entry: Entry): SurfaceNode["kind"] | null {
	return sendMessageProject(entry) ? "send_message" : null;
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

function viewHidden(): EntryMeta {
	return { view: { project: () => [] } };
}

export const EVENT_META: Record<string, EntryMeta> = {
	"role:user": { view: { project: userRow }, slice: { node: "user", project: messageProject } },
	"role:assistant": {
		view: { project: () => [] },
		slice: { node: "assistant", project: messageProject },
	},

	[EVENTS.sendMessage]: { view: { project: sendMessageRow }, slice: { node: sendMessageNode, project: sendMessageProject } },
	[EVENTS.turnEnd]: { view: { project: turnEndRow } },
	[EVENTS.escalationRequest]: { view: { project: escalationRow } },
	[EVENTS.commandRun]: { view: { project: commandRow } },
	[EVENTS.skillRun]: { view: { project: skillRow } },
	[EVENTS.shellRun]: { view: { project: shellRow } },

	[EVENTS.commandDone]: viewHidden(),
	[EVENTS.skillDone]: viewHidden(),
	[EVENTS.shellDone]: viewHidden(),
	[EVENTS.escalationDecision]: viewHidden(),
	[EVENTS.memoryRunStart]: viewHidden(),
	[EVENTS.memoryRunEnd]: viewHidden(),

	[EVENTS.toolResult]: { ...viewHidden(), slice: { node: "tool_result", project: toolResultProject } },
	[EVENTS.timeGapReminder]: { ...viewHidden(), slice: { node: "user", project: textUserProject } },
	[EVENTS.contextChanged]: { ...viewHidden(), slice: { node: "user", project: contextChangedProject } },
	[EVENTS.instructionsChanged]: { ...viewHidden(), slice: { node: "user", project: instructionsChangedProject } },
	[EVENTS.mcpChanged]: { ...viewHidden(), slice: { node: "user", project: mcpChangedProject } },
	[EVENTS.userEdited]: { ...viewHidden(), slice: { node: "user", project: textUserProject } },

	[EVENTS.surfaceOp]: viewHidden(),
	[EVENTS.compactionSummary]: { ...viewHidden(), slice: { project: textUserProject } },

	[EVENTS.turnStart]: viewHidden(),
	[EVENTS.stepStart]: viewHidden(),
	[EVENTS.stepEnd]: viewHidden(),
	[EVENTS.toolCall]: viewHidden(),
	[EVENTS.requestHeader]: viewHidden(),
	[EVENTS.systemPrompt]: viewHidden(),
	[EVENTS.followUp]: viewHidden(),
	[EVENTS.compactionStart]: viewHidden(),
	[EVENTS.compactionEnd]: viewHidden(),
	[EVENTS.compactionPrune]: viewHidden(),
	[EVENTS.modelChange]: viewHidden(),
	[EVENTS.retryScheduled]: viewHidden(),
	[EVENTS.retryStarted]: viewHidden(),
};

export function entryKey(entry: Entry): string {
	if (entry.type === "message") return `role:${entry.message.role}`;
	if (entry.type === "custom") return entry.customType;
	return entry.type;
}

export function buildViewContext(entries: Entry[]): ViewProjectionContext {
	const commandDones = new Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>();
	const skillDones = new Map<string, { kind: "success" | "error"; text?: string }>();
	const shellDones = new Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>();
	const escalationDecisions = new Map<string, { kind: "approved" | "rejected" | "dropped" }>();
	const editedUserText = new Map<string, string>();
	const rewoundIds = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		const custom = entry as CustomEntryOf<Entry>;
		if (custom.customType === EVENTS.commandDone) {
			const data = custom.data as { commandId?: unknown; kind?: unknown; text?: unknown } | undefined;
			if (data?.commandId != null) {
				commandDones.set(String(data.commandId), { kind: data.kind === "error" ? "error" : "success", ...(typeof data.text === "string" ? { text: data.text } : {}) });
			}
		} else if (custom.customType === EVENTS.skillDone) {
			const data = custom.data as { skillId?: unknown; kind?: unknown; text?: unknown } | undefined;
			if (data?.skillId != null) {
				skillDones.set(String(data.skillId), { kind: data.kind === "error" ? "error" : "success", ...(typeof data.text === "string" ? { text: data.text } : {}) });
			}
		} else if (custom.customType === EVENTS.shellDone) {
			const data = custom.data as { shellId?: unknown; kind?: unknown; text?: unknown } | undefined;
			if (data?.shellId != null) {
				shellDones.set(String(data.shellId), { kind: data.kind === "error" ? "error" : "success", ...(typeof data.text === "string" ? { text: data.text } : {}) });
			}
		} else if (custom.customType === EVENTS.escalationDecision) {
			const data = custom.data as { escalationId?: unknown; approved?: unknown; dropped?: unknown } | undefined;
			if (data?.escalationId != null) {
				escalationDecisions.set(String(data.escalationId), {
					kind: data.dropped === true ? "dropped" : data.approved === true ? "approved" : "rejected",
				});
			}
		} else if (custom.customType === EVENTS.userEdited) {
			const data = custom.data as { targetId?: unknown; text?: unknown; shadowedIds?: unknown } | undefined;
			if (data?.targetId != null && typeof data.text === "string") editedUserText.set(String(data.targetId), data.text);
			if (Array.isArray(data?.shadowedIds)) {
				for (const id of data.shadowedIds) if (typeof id === "string") rewoundIds.add(id);
			}
		}
	}
	return { commandDones, skillDones, shellDones, escalationDecisions, editedUserText, rewoundIds };
}

export function projectVisibleHistory(entries: Entry[]): ViewItem[] {
	const ctx = buildViewContext(entries);
	return entries.filter((entry) => !ctx.rewoundIds.has(entry.id)).flatMap((entry) => EVENT_META[entryKey(entry)]?.view?.project(entry, ctx) ?? []);
}
