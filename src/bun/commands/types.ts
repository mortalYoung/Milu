import type { CommandKind, CommandResult, ContextSnapshot, SandboxMode, ThinkingLevel } from "../../shared/rpc";
import type { Permission } from "../permission";
import type { SessionScope } from "../persist";

export interface ReadonlyContext {
	readonly turn: number;
	readonly running: boolean;
	readonly lastVisibleAt: number;
	readonly lastTurnEndAt: number;
	readonly storage_path: string | null;
	readonly workspace_path: string | null;
	readonly sandbox_mode: SandboxMode;
	readonly model: { provider: string; modelId?: string } | null;
	readonly thinkingLevel: ThinkingLevel;
	composeSystemPrompt(): string;
	visibleElapsedMs(): number;
}

export interface CommandUtils {
	prompt(text: string): Promise<{ ok: boolean; error?: string }>;
	snapshot(): Promise<ContextSnapshot>;
	sendMessage(text: string): Promise<void>;
}

export interface CommandAgentSurface {
	readonly isStreaming: boolean;
	readonly context: ReadonlyContext;
	reset(): void;
	setWorkspace(path: string | null): void;
	readonly permission: Permission;
	snapshot(): Promise<ContextSnapshot>;
	prompt(text: string): Promise<{ ok: boolean; error?: string }>;
	sendMessage(text: string): Promise<void>;
	setModel(model: { provider: string; modelId?: string } | null): void;
	setSandboxMode(mode: SandboxMode): void;
	setThinkingLevel(level: ThinkingLevel): void;
}

export interface CommandContext {
	partner: string;
	dir: string;
	scope: SessionScope;
	agent: CommandAgentSurface;
	persistWorkspace(path: string): Promise<void>;
	runManualCompact(signal?: AbortSignal): Promise<{ ok: boolean; error?: string; compacted?: number }>;
	organizeMemory(signal?: AbortSignal): Promise<{ ok: boolean; error?: string; added?: number }>;
	onCommandRun(commandId: string): void;
	onCommandDone(commandId: string): void;
	/** Rotate to a fresh session file (archives the current one) and reset agent memory. */
	resetSession(signal?: AbortSignal): Promise<{ ok: boolean; error?: string }>;
}

export interface CommandInvocation {
	commandId: string;
	ctx: CommandContext;
	rawInput: string;
	signal: AbortSignal;
	context: ReadonlyContext;
	utils: CommandUtils;
}

export interface CommandDefinition {
	name: string;
	description: string;
	kind: CommandKind;
	hint?: string;
	recordInput?: boolean;
	handler: (invocation: CommandInvocation) => Promise<CommandResult>;
}

export function commandUtilsFrom(ctx: CommandContext): CommandUtils {
	return {
		prompt: (text) => ctx.agent.prompt(text),
		snapshot: () => ctx.agent.snapshot(),
		sendMessage: (text) => ctx.agent.sendMessage(text),
	};
}
