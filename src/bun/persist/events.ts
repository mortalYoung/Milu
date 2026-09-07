import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { EVENTS } from "../../shared/events";
import type { SandboxMode } from "../../shared/rpc";

export { EVENTS };

export type TurnEndReason = "completed" | "error" | "aborted" | "interrupted";

export interface TurnStartEventData {
	turn: number;
}

export interface TurnEndEventData {
	turn: number;
	reason: TurnEndReason;
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

export interface ToolResultEventData {
	toolCallId: string;
	toolName: string;
	content: ToolResultMessage["content"];
	details?: unknown;
	usage?: unknown;
	isError: boolean;
}

export interface SkillRunEventData {
	skillId: string;
	name: string;
	content?: string;
	hint?: string;
}

export interface SkillDoneEventData {
	skillId: string;
	name: string;
	kind: "success" | "error";
	text?: string;
}

export interface CommandRunEventData {
	commandId: string;
	name: string;
	args?: string;
}

export interface CommandDoneEventData {
	commandId: string;
	kind: "success" | "error" | "interrupted";
	text?: string;
}

export interface ShellRunEventData {
	shellId: string;
	command: string;
}

export interface ShellDoneEventData {
	shellId: string;
	command: string;
	kind: "success" | "error" | "interrupted";
	text?: string;
	exitCode?: number;
}

export interface SkillDigestItem {
	name: string;
	description: string;
	digest: string;
}

export interface ContextChangedEventData {
	workspace: string | null;
	storage: string | null;
	sandbox: SandboxMode;
	skills: SkillDigestItem[];
}

export interface InstructionsChangedEventData {
	agentMd: string | null;
}

export interface McpChangedEventData {
	server: string;
	change: "added" | "removed";
	granted: string[];
	timestamp?: number;
}

export type MemoryRunEndReason = "completed" | "attempts-exhausted" | "error" | "interrupted";

export interface MemoryRunStartEventData {
	runId: string;
	sessionFile: string;
	startedAt: number;
	entries: number;
	targetRawId: string;
	cursorRawId: string | null;
}

export interface MemoryRunTraceEvent {
	event: "read_raw" | "read_memory" | "write_memory" | "finish" | "attempt_end" | "checkpoint";
	at?: number;
	from?: string;
	limit?: number;
	returned?: number;
	query?: string;
	regex?: boolean;
	kind?: string;
	rawIds?: string[];
	accepted?: boolean;
	memoryId?: string;
	error?: string;
	attempt?: number;
	progressRawId?: string | null;
	lastRawId?: string;
}

export interface MemoryRunModelMessage {
	attempt: number;
	role: "assistant";
	block: "thinking" | "text";
	text: string;
}

export interface MemoryRunEndEventData {
	runId: string;
	sessionFile: string;
	startedAt: number;
	endedAt: number;
	durationMs: number;
	reason: MemoryRunEndReason;
	attempts: number;
	added: number;
	error?: string;
	checkpoints?: string[];
	trace?: MemoryRunTraceEvent[];
	modelMessages?: MemoryRunModelMessage[];
}

export interface RetryScheduledEventData {
	retryId: string;
	turn: number;
	step: number;
	provider: string;
	model: string;
	retry: number;
	maxRetries: number;
	delayMs: number;
	errorMessage: string;
}

export interface RetryStartedEventData {
	retryId: string;
	turn: number;
	step: number;
	retry: number;
}
