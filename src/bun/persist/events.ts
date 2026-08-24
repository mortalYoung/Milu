/**
 * The session log's event vocabulary: every event type that can be persisted,
 * its custom-entry name, and the shape of its payload. Adapted from the
 * deepseek-harness session-log design (session-log-content-and-durability.md):
 *
 * - turn/start · turn/end — one outer-loop run (agent_start → agent_end)
 * - step/start · step/end — one inner-loop iteration (pi turn_start → turn_end),
 *   i.e. one model call + the tool executions it requested
 * - tool/call · tool/result — a tool invocation, recorded at execution time so a
 *   crash mid-turn leaves the call (and result) in the log
 * - request/header — the full rendered request head (system prompt + tool names),
 *   appended before the request is dispatched (every request is reconstructable)
 *
 * Message-shaped events (user, assistant) are persisted as pi message entries;
 * everything here is a custom entry. Tool results are the only vocabulary events
 * that join the surface (the model's next request must see them); the rest are
 * log-only.
 *
 * Appends are durability barriers: each scope append resolves only after the
 * entry has been written to the log file, so an awaited append is a checkpoint.
 * A write-behind batching layer could sit behind this interface without
 * changing callers.
 */
import type { ToolResultMessage } from "@earendil-works/pi-ai";

/** Custom-entry names for the vocabulary (the log format contract). */
export const EVENTS = {
	turnStart: "turn/start",
	turnEnd: "turn/end",
	stepStart: "step/start",
	stepEnd: "step/end",
	toolCall: "tool/call",
	toolResult: "tool/result",
	requestHeader: "request/header",
	sendMessage: "send_message",
	systemPrompt: "system_prompt",
	systemReminder: "system_reminder",
	escalationRequest: "escalation/request",
	escalationDecision: "escalation/decision",
	surfaceOp: "surface_op",
	compactionSummary: "compaction_summary",
	compactionStart: "compaction/start",
	compactionEnd: "compaction/end",
} as const;

/** Why a run ended (turn/end payload). */
export type TurnEndReason = "completed" | "error" | "aborted" | "interrupted";

export interface TurnStartEventData {
	turn: number;
}

export interface TurnEndEventData {
	turn: number;
	reason: TurnEndReason;
	/** The run's error message (reason "error" only) — persisted so a failed run is reconstructable after restart. */
	error?: string;
}

export interface StepStartEventData {
	turn: number;
	step: number;
}

export interface StepEndEventData {
	turn: number;
	step: number;
}

export interface ToolCallEventData {
	turn: number;
	step: number;
	callId: string;
	name: string;
	args: unknown;
}

/** The pieces of a ToolResultMessage the log must keep to rebuild it (see surface.deriveEventMessage). */
export interface ToolResultEventData {
	toolCallId: string;
	toolName: string;
	content: ToolResultMessage["content"];
	details?: unknown;
	usage?: unknown;
	isError: boolean;
}
