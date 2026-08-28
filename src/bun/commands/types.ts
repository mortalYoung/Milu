import type { CommandKind, CommandResult } from "../../shared/rpc";
import type { SessionScope } from "../persist";

/** The slice of PartnerAgent default command handlers need (keeps commands independent of index.ts). */
export interface CommandAgentSurface {
	readonly isStreaming: boolean;
	reset(): void;
	setWorkspace(path: string | null): void;
	readonly permission: {
		setWorkspace(path: string): { allowed: true; resolved: string } | { allowed: false; reason: string };
	};
}

export interface CommandContext {
	partner: string;
	dir: string;
	scope: SessionScope;
	agent: CommandAgentSurface;
	persistWorkspace(path: string): Promise<void>;
	runManualCompact(): Promise<{ ok: boolean; error?: string; compacted?: number }>;
	onCommandRun(commandId: string): void;
	onCommandDone(commandId: string): void;
}

export interface CommandInvocation {
	commandId: string;
	ctx: CommandContext;
	/** Raw text after the command name, including the separating whitespace. */
	rawInput: string;
	signal: AbortSignal;
}

export interface CommandDefinition {
	name: string;
	description: string;
	kind: CommandKind;
	/** leadingInput commands: hint shown after the command name. */
	hint?: string;
	/** Whether rawInput is recorded in command/run. Default true. */
	recordInput?: boolean;
	handler: (invocation: CommandInvocation) => Promise<CommandResult>;
}
