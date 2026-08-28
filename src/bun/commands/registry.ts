import type { CommandDescriptor, CommandResult } from "../../shared/rpc";
import { parseCommand } from "./parse";
import type { CommandContext, CommandDefinition } from "./types";

export interface CommandExecution {
	commandId: string;
	result: CommandResult;
}

export interface CommandRegistry {
	register(def: CommandDefinition): void;
	list(): CommandDescriptor[];
	/** Returns undefined for parse failures / unknown commands (nothing is logged). */
	execute(line: string, ctx: CommandContext): Promise<CommandExecution | undefined>;
}

let commandSeq = 0;

export function createCommandRegistry(): CommandRegistry {
	const definitions = new Map<string, CommandDefinition>();
	return {
		register(def) {
			if (definitions.has(def.name)) throw new Error(`command /${def.name} already registered`);
			definitions.set(def.name, def);
		},
		list() {
			return [...definitions.values()].map(({ name, description, kind, hint }) => ({ name, description, kind, ...(hint ? { hint } : {}) }));
		},
		async execute(line, ctx) {
			const parsed = parseCommand(line);
			const def = parsed ? definitions.get(parsed.name) : undefined;
			if (!parsed || !def) return undefined;
			const commandId = `cmd-${Date.now().toString(36)}-${++commandSeq}`;
			await ctx.scope.appendCommandRun({ commandId, name: def.name, ...(def.recordInput !== false && parsed.rawInput.trim() ? { args: parsed.rawInput.trim() } : {}) }, Date.now());
			ctx.onCommandRun(commandId);
			try {
				const result = await def.handler({ commandId, ctx, rawInput: parsed.rawInput, signal: new AbortController().signal });
				await ctx.scope.appendCommandDone({ commandId, kind: result.kind, ...(result.text ? { text: result.text } : {}) }, Date.now());
				ctx.onCommandDone(commandId);
				return { commandId, result };
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				await ctx.scope.appendCommandDone({ commandId, kind: "error", text }, Date.now()).catch(() => {});
				ctx.onCommandDone(commandId);
				throw error;
			}
		},
	};
}
