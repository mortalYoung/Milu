import { createServiceId, type Service } from "@milu/di";

export interface ComposerCommand {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly kind: "execute" | "leadingInput";
	readonly action: string;
	readonly hint?: string;
	readonly category?: "command" | "skill";
}

export class CommandRegistry implements Service {
	private readonly _commands = new Map<string, ComposerCommand>();

	constructor(commands: readonly ComposerCommand[]) {
		for (const command of commands) {
			if (this._commands.has(command.name)) throw new Error(`command "/${command.name}" is already contributed`);
			this._commands.set(command.name, command);
		}
	}

	all(): readonly ComposerCommand[] {
		return [...this._commands.values()];
	}

	find(name: string): ComposerCommand | undefined {
		return this._commands.get(name);
	}

	dispose(): void {
		this._commands.clear();
	}
}

export const CommandRegistryId = createServiceId<CommandRegistry>("CommandRegistry");
