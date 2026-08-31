import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { SandboxMode } from "../../shared/rpc";

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
	followUp: "message/follow_up",
	escalationRequest: "escalation/request",
	escalationDecision: "escalation/decision",
	surfaceOp: "surface_op",
	compactionSummary: "compaction_summary",
	compactionStart: "compaction/start",
	compactionEnd: "compaction/end",
	modelChange: "model_change",
	thinkingLevelChange: "thinking_level_change",
	commandRun: "command/run",
	commandDone: "command/done",
	contextChanged: "context/changed",
	skillRun: "skill/run",
	skillDone: "skill/done",
	shellRun: "shell/run",
	shellDone: "shell/done",
	retryScheduled: "retry/scheduled",
	retryStarted: "retry/started",
} as const;

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
	kind: "success" | "error";
	text?: string;
}

export interface ShellRunEventData {
	shellId: string;
	command: string;
}

export interface ShellDoneEventData {
	shellId: string;
	command: string;
	kind: "success" | "error";
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
