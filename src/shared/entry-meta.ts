import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { contextChangedText, EVENTS, instructionsChangedText, mcpChangedText } from "./events";
import type { SandboxMode, ViewItem } from "./rpc";
import type { SurfaceNode } from "./surface";

export interface ViewMeta {
	visit(entry: Entry, out: ViewItem[]): void;
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

function userEditedVisit(entry: Entry, out: ViewItem[]): void {
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
	return { view: { visit: () => {} } };
}

export const EVENT_META: Record<string, EntryMeta> = {
	"role:user": { view: { visit: userVisit }, slice: { node: "user", project: messageProject } },
	"role:assistant": {
		...viewHidden(),
		slice: { node: "assistant", project: messageProject },
	},

	[EVENTS.sendMessage]: { view: { visit: sendMessageVisit }, slice: { node: sendMessageNode, project: sendMessageProject } },
	[EVENTS.turnEnd]: { view: { visit: turnEndVisit } },
	[EVENTS.escalationRequest]: { view: { visit: escalationVisit } },
	[EVENTS.commandRun]: { view: { visit: commandVisit } },
	[EVENTS.skillRun]: { view: { visit: skillVisit } },
	[EVENTS.shellRun]: { view: { visit: shellVisit } },

	[EVENTS.commandDone]: { view: { visit: commandDoneVisit } },
	[EVENTS.skillDone]: { view: { visit: skillDoneVisit } },
	[EVENTS.shellDone]: { view: { visit: shellDoneVisit } },
	[EVENTS.escalationDecision]: { view: { visit: escalationDecisionVisit } },
	[EVENTS.memoryRunStart]: viewHidden(),
	[EVENTS.memoryRunEnd]: viewHidden(),

	[EVENTS.toolResult]: { ...viewHidden(), slice: { node: "tool_result", project: toolResultProject } },
	[EVENTS.timeGapReminder]: { ...viewHidden(), slice: { node: "user", project: textUserProject } },
	[EVENTS.contextChanged]: { ...viewHidden(), slice: { node: "user", project: contextChangedProject } },
	[EVENTS.instructionsChanged]: { ...viewHidden(), slice: { node: "user", project: instructionsChangedProject } },
	[EVENTS.mcpChanged]: { ...viewHidden(), slice: { node: "user", project: mcpChangedProject } },
	[EVENTS.userEdited]: { view: { visit: userEditedVisit }, slice: { node: "user", project: textUserProject } },

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

export function projectVisibleHistory(entries: Entry[]): ViewItem[] {
	const out: ViewItem[] = [];
	for (const entry of entries) {
		EVENT_META[entryKey(entry)]?.view?.visit(entry, out);
	}
	return out;
}
