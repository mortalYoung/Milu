/**
 * Surface folding (log → surface → dialogue), adapted from the deepseek-harness
 * session-surface design (docs/2026-08-19-session-surface-refactor.md).
 *
 * The log (pi JSONL) is the SSOT and never mutates. foldSurface replays it in
 * order: message-shaped events append a node; `surface_op` custom entries apply
 * a logged replace (splice + provenance check). deriveMessages projects the
 * surface into the pi AgentMessage chain the model sees — the derivation path
 * the agent should use for restore and compaction.
 */
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { Surface, SurfaceNode, SurfaceOpRecord } from "../../shared/surface";
import { EVENTS } from "../persist/events";

/** Custom entry types that join the surface (log-only custom types are skipped). */
const SURFACE_CUSTOM_TYPES = new Set<string>([EVENTS.sendMessage, EVENTS.toolResult]);

export class SurfaceError extends Error {}

/** True when a pi entry can appear as a surface node (append-origin). */
export function isSurfaceEntry(entry: Entry): boolean {
	if (entry.type === "message") {
		return entry.message.role === "user" || entry.message.role === "assistant";
	}
	return entry.type === "custom" && SURFACE_CUSTOM_TYPES.has(entry.customType);
}

/** The time of a pi entry (message timestamp or custom data timestamp). */
function entryTime(entry: Entry): number {
	if (entry.type === "message") return entry.message.timestamp ?? entry.timestamp ?? 0;
	if (entry.type === "custom") {
		const data = entry.data as { timestamp?: number } | undefined;
		return data?.timestamp ?? entry.timestamp ?? 0;
	}
	return entry.timestamp ?? 0;
}

/** Build the surface node for an entry at the given surface position (null when log-only). */
function nodeFor(entry: Entry, seq: number): SurfaceNode | null {
	if (entry.type === "message") {
		const time = entryTime(entry);
		if (entry.message.role === "user") return { kind: "user", seq, id: entry.id, time };
		if (entry.message.role === "assistant") return { kind: "assistant", seq, id: entry.id, time };
		return null;
	}
	if (entry.type === "custom" && entry.customType === EVENTS.sendMessage) {
		return { kind: "send_message", seq, id: entry.id, time: entryTime(entry) };
	}
	if (entry.type === "custom" && entry.customType === EVENTS.toolResult) {
		return { kind: "tool_result", seq, id: entry.id, time: entryTime(entry) };
	}
	return null;
}

/**
 * Fold the full log into the current surface by replaying entries in order.
 * Deterministic: the same log always yields the same surface.
 */
export function foldSurface(entries: Entry[]): Surface {
	const nodes: SurfaceNode[] = [];
	let replaceGeneration = 0;
	// compaction summaries referenced by a later surface_op as the replacement checkpoint node
	const pendingSummaries = new Map<string, Entry>();
	for (const entry of entries) {
		if (entry.type === "custom") {
			if (entry.customType === "compaction_summary") {
				pendingSummaries.set(entry.id, entry);
				continue;
			}
			if (entry.customType === "surface_op") {
				const op = (entry.data ?? {}) as SurfaceOpRecord;
				applyReplace(nodes, op, entry.id, pendingSummaries);
				replaceGeneration = op.replaceGeneration;
				continue;
			}
		}
		const node = nodeFor(entry, nodes.length);
		if (node) nodes.push(node);
	}
	return { nodes, replaceGeneration };
}

/** Apply a logged replace to the surface (inclusive [start,end]); validate provenance. */
export function applyReplace(nodes: SurfaceNode[], op: SurfaceOpRecord, opEntryId: string, pendingSummaries?: Map<string, Entry>): void {
	if (op.op !== "replace") {
		throw new SurfaceError(`surface_op ${opEntryId}: unknown op ${JSON.stringify(op)}`);
	}
	if (!Number.isInteger(op.start) || !Number.isInteger(op.end) || op.start < 0 || op.end < op.start || op.end >= nodes.length) {
		throw new SurfaceError(`surface_op ${opEntryId}: invalid range [${op.start}, ${op.end}] for ${nodes.length} nodes`);
	}
	const shadowed = nodes.slice(op.start, op.end + 1);
	const shadowedIds = new Set(shadowed.map((n) => n.id));
	const missing = shadowed.filter((n) => !op.sourceEventSeqs.includes(n.id));
	if (missing.length > 0) {
		throw new SurfaceError(`surface_op ${opEntryId}: provenance missing ${missing.map((n) => n.id).join(",")}`);
	}
	const extra = op.sourceEventSeqs.filter((id) => !shadowedIds.has(id));
	if (extra.length > 0) {
		throw new SurfaceError(`surface_op ${opEntryId}: sourceEventSeqs lists non-shadowed ${extra.join(",")}`);
	}
	nodes.splice(op.start, op.end - op.start + 1);
	if (op.checkpointId) {
		const summary = pendingSummaries?.get(op.checkpointId);
		if (!summary) {
			throw new SurfaceError(`surface_op ${opEntryId}: checkpoint ${op.checkpointId} not found`);
		}
		nodes.splice(op.start, 0, { kind: "user", seq: op.start, id: summary.id, time: entryTime(summary) });
	}
}

/** Project the surface into the pi AgentMessage chain the model sees. */
export function deriveMessages(entries: Entry[], surface: Surface): AgentMessage[] {
	return dropDanglingTurn(projectChain(entries, surface));
}

/** One surface node → one message (null for log-only entries that never reach the surface). */
export function deriveEventMessage(entry: Entry): AgentMessage | null {
	if (entry.type === "message") {
		// The persisted pi message is already the exact shape the agent loop consumes
		return entry.message as unknown as AgentMessage;
	}
	if (entry.type === "custom" && entry.customType === EVENTS.sendMessage) {
		const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
		return {
			role: "custom",
			customType: "send_message",
			content: typeof data.text === "string" ? data.text : "",
			display: true,
			timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		} as AgentMessage;
	}
	if (entry.type === "custom" && entry.customType === EVENTS.toolResult) {
		// The log keeps a tool/result event (see persist/events.ts); rebuild the toolResult message
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
	if (entry.type === "custom" && entry.customType === EVENTS.compactionSummary) {
		// The compaction checkpoint projects as a user message (the summary the model sees)
		const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
		return {
			role: "user",
			content: typeof data.text === "string" ? data.text : "",
			timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		} as AgentMessage;
	}
	return null;
}

/** Surface → message chain without the dangling-turn guard (the resume path keeps the turn). */
export function projectChain(entries: Entry[], surface?: Surface): AgentMessage[] {
	const byId = new Map<string, Entry>();
	for (const e of entries) byId.set(e.id, e);
	const out: AgentMessage[] = [];
	const nodes = (surface ?? foldSurface(entries)).nodes;
	for (const node of nodes) {
		const entry = byId.get(node.id);
		if (!entry) continue; // shadowed or unknown → nothing to project
		const msg = deriveEventMessage(entry);
		if (msg) out.push(msg);
	}
	return out;
}

/**
 * Locate the assistant tool-call turn for a restart-resume: project without dropping the
 * dangling turn and return the messages plus the insertion index for the matching tool
 * result. Null when the turn is gone (compacted away) or superseded by a later run — the
 * escalation is then orphaned, not resumable.
 */
export function buildResumeTurn(entries: Entry[], toolCallId: string): { messages: AgentMessage[]; insertAt: number } | null {
	const messages = projectChain(entries);
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const blocks = m.content as { type: string; id: string }[];
		if (!blocks.some((b) => b.type === "toolCall" && b.id === toolCallId)) continue;
		// Anything but user messages after the turn means a later run (or another tool turn)
		// superseded it — inserting the result mid-history would corrupt the chain.
		if (messages.slice(i + 1).some((m2) => m2.role === "assistant" || m2.role === "toolResult")) return null;
		return { messages, insertAt: i + 1 };
	}
	return null;
}

/**
 * Guard for an unfinished final turn: the last assistant contains toolCall blocks but lacks the
 * matching toolResult (restart-interruption scenario) → drop that turn so the model never sees a
 * dangling tool call. Mirrors pi's restart repair at the surface layer (see also persist/store.ts).
 */
export function dropDanglingTurn(messages: AgentMessage[]): AgentMessage[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const blocks = m.content as { type: string; id: string }[];
		const hasToolCalls = blocks.some((b) => b.type === "toolCall");
		if (!hasToolCalls) break;
		const next = messages[i + 1];
		const complete = next != null && next.role === "toolResult" && (next as ToolResultMessage).toolCallId === blocks.find((b) => b.type === "toolCall")?.id;
		if (complete) break;
		messages.splice(i);
		break;
	}
	return messages;
}

/** Reconstruct the last request header (system prompt + tool names) from the log — invariant 1. */
export function reconstructRequestHeader(entries: Entry[]): { systemPrompt: string; toolNames: string[]; time: number } | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== EVENTS.requestHeader) continue;
		const data = (entry.data ?? {}) as { systemPrompt?: unknown; toolNames?: unknown; timestamp?: unknown };
		return {
			systemPrompt: typeof data.systemPrompt === "string" ? data.systemPrompt : "",
			toolNames: Array.isArray(data.toolNames) ? data.toolNames.filter((n): n is string => typeof n === "string") : [],
			time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		};
	}
	return null;
}
