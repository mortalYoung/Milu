/**
 * Per-entry metadata registry for the Origin (the append-only JSONL log).
 *
 * Concept naming (see docs/2026-09-02-origin-slice-view-naming.md):
 *   Origin  = the immutable log (rawEntries / EVENTS)
 *   Slice   = the model-visible projection (surface.nodes)
 *   View    = the human chat transcript (visibleHistory)
 *
 * Every EVENTS value (and every pi message role) gets one row here. Concerns are namespaced so
 * future views can attach their own metadata without touching existing logic:
 *
 *   - `chat`       — how / whether this Origin entry appears in the user View (chat transcript)
 *   - `trajectory` — (future) label / ordering for the Timeline (Trajectory drawer)
 *
 * The chat projector is the single source of truth: a row registered with a `chat` block can
 * produce rows, and returning `[]` means this particular entry is hidden. Entries without a
 * `chat` block (or whose projector always returns `[]`) never render in the View.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENTS } from "./events";
import type { SandboxMode, ViewItem } from "./rpc";

/** Precomputed per-fold context: Done/Decision events enrich their Run rows. */
export interface ChatProjectionContext {
	commandDones: Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>;
	skillDones: Map<string, { kind: "success" | "error"; text?: string }>;
	shellDones: Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>;
	escalationDecisions: Map<string, { kind: "approved" | "rejected" | "dropped" }>;
}

export interface ChatMeta {
	/** Build the chat rows for one entry; return [] when this particular entry is hidden. */
	project(entry: Entry, ctx: ChatProjectionContext): ViewItem[];
}

/** Reserved for the trajectory view (labels etc.). */
export interface TrajectoryMeta {
	label: string;
}

export interface EntryMeta {
	chat?: ChatMeta;
	trajectory?: TrajectoryMeta;
}

type CustomEntryOf<E extends Entry> = Extract<E, { type: "custom" }>;

const row = (id: string, kind: ViewItem["kind"], text: string, time: number): ViewItem => ({ id, kind, text, time });

function userRow(entry: Entry): ViewItem[] {
	if (entry.type !== "message" || entry.message.role !== "user") return [];
	const content = entry.message.content;
	const skill = (entry.message as { skill?: unknown }).skill;
	const text = typeof content === "string" ? content : "";
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
	// Shell heartbeats are model-visible duplicates of the shell row; never show them in chat.
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

function escalationRow(entry: Entry, ctx: ChatProjectionContext): ViewItem[] {
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

function commandRow(entry: Entry, ctx: ChatProjectionContext): ViewItem[] {
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

function skillRow(entry: Entry, ctx: ChatProjectionContext): ViewItem[] {
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

function shellRow(entry: Entry, ctx: ChatProjectionContext): ViewItem[] {
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

/** Log-only events: never render a chat row, but stay registered for documentation/lookup. */
function logOnly(): EntryMeta {
	return { chat: { project: () => [] } };
}

/**
 * Registry keyed by `role:<role>` for pi message entries and by EVENTS customType for custom
 * entries. Lookup misses (unknown / native non-custom types) default to hidden — safe for
 * forward compatibility.
 */
export const EVENT_META: Record<string, EntryMeta> = {
	"role:user": { chat: { project: userRow } },
	"role:assistant": {
		// Assistant text is delivered as send_message heartbeats; the raw message never renders.
		chat: { project: () => [] },
	},

	[EVENTS.sendMessage]: { chat: { project: sendMessageRow } },
	[EVENTS.turnEnd]: { chat: { project: turnEndRow } }, // aborted / error only
	[EVENTS.escalationRequest]: { chat: { project: escalationRow } },
	[EVENTS.commandRun]: { chat: { project: commandRow } },
	[EVENTS.skillRun]: { chat: { project: skillRow } },
	[EVENTS.shellRun]: { chat: { project: shellRow } },

	// Done/decision events never render; they only enrich their Run row through the context.
	[EVENTS.commandDone]: logOnly(),
	[EVENTS.skillDone]: logOnly(),
	[EVENTS.shellDone]: logOnly(),
	[EVENTS.escalationDecision]: logOnly(),
	[EVENTS.memoryRunStart]: logOnly(),
	[EVENTS.memoryRunEnd]: logOnly(),

	// Log-only machinery.
	[EVENTS.turnStart]: logOnly(),
	[EVENTS.stepStart]: logOnly(),
	[EVENTS.stepEnd]: logOnly(),
	[EVENTS.toolCall]: logOnly(),
	[EVENTS.toolResult]: logOnly(),
	[EVENTS.requestHeader]: logOnly(),
	[EVENTS.systemPrompt]: logOnly(),
	[EVENTS.followUp]: logOnly(),
	[EVENTS.timeGapReminder]: logOnly(),
	[EVENTS.surfaceOp]: logOnly(),
	[EVENTS.compactionSummary]: logOnly(),
	[EVENTS.compactionStart]: logOnly(),
	[EVENTS.compactionEnd]: logOnly(),
	[EVENTS.compactionPrune]: logOnly(),
	[EVENTS.modelChange]: logOnly(),
	[EVENTS.thinkingLevelChange]: logOnly(),
	[EVENTS.contextChanged]: logOnly(),
	[EVENTS.retryScheduled]: logOnly(),
	[EVENTS.retryStarted]: logOnly(),
};

/** Discriminator used to look up EVENT_META (native non-custom types fall through as hidden). */
export function entryKey(entry: Entry): string {
	if (entry.type === "message") return `role:${entry.message.role}`;
	if (entry.type === "custom") return entry.customType;
	return entry.type;
}

/** Build the Done/Decision maps once per fold. */
export function buildChatContext(entries: Entry[]): ChatProjectionContext {
	const commandDones = new Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>();
	const skillDones = new Map<string, { kind: "success" | "error"; text?: string }>();
	const shellDones = new Map<string, { kind: "success" | "error" | "interrupted"; text?: string }>();
	const escalationDecisions = new Map<string, { kind: "approved" | "rejected" | "dropped" }>();
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
		}
	}
	return { commandDones, skillDones, shellDones, escalationDecisions };
}

/** Project the full log into the human chat transcript via EVENT_META. */
export function projectVisibleHistory(entries: Entry[]): ViewItem[] {
	const ctx = buildChatContext(entries);
	return entries.flatMap((entry) => EVENT_META[entryKey(entry)]?.chat?.project(entry, ctx) ?? []);
}
