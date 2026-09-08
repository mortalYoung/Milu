import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { SandboxMode } from "./rpc";

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
	timeGapReminder: "time_gap_reminder",
	escalationRequest: "escalation/request",
	escalationDecision: "escalation/decision",
	surfaceOp: "surface_op",
	compactionSummary: "compaction_summary",
	compactionStart: "compaction/start",
	compactionEnd: "compaction/end",
	compactionPrune: "compaction/prune",
	modelChange: "model_change",
	commandRun: "command/run",
	commandDone: "command/done",
	contextChanged: "context/changed",
	instructionsChanged: "instructions/changed",
	mcpChanged: "mcp/changed",
	userEdited: "user/edited",
	memoryRunStart: "memory/run/start",
	memoryRunEnd: "memory/run/end",
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

export interface UserEditedEventData {
	targetId: string;
	text: string;
	shadowedIds: string[];
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

// ——— model text renderers ———

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function contextChangedText(data: ContextChangedEventData): string {
	const lines: string[] = [];
	if (data.workspace) lines.push(`Current workspace: ${data.workspace}.`);
	lines.push(`Current storage: ${data.storage ?? "unset"}.`, `Current sandbox mode: ${data.sandbox}.`);
	if (data.skills.length > 0) {
		lines.push(
			"",
			"<available_skills>",
			...data.skills.map((s) => `- ${escapeXml(s.name)}: ${escapeXml(s.description)}`),
			"</available_skills>",
			"",
			"When a task matches a skill above, call the skill tool with its exact name to load the full instructions. The latest <available_skills> message is authoritative.",
		);
	}
	return `<system_reminder>${lines.join("\n")}</system_reminder>`;
}

export function instructionsChangedText(agentMd: string | null): string {
	if (agentMd) return `<system_reminder>Workspace instructions:\n\n${agentMd}</system_reminder>`;
	return `<system_reminder>Workspace cleared; file operations now fall back to storage.</system_reminder>`;
}

export function mcpChangedText(data: McpChangedEventData): string {
	const granted = data.granted.length > 0 ? data.granted.join(", ") : "none";
	const action = data.change === "added" ? `MCP server "${data.server}" is now authorized` : `MCP server "${data.server}" is no longer authorized`;
	return `<system_reminder>${action}. Authorized servers: ${granted}. Use mcp_list to see available tools and mcp_call to invoke one.</system_reminder>`;
}
