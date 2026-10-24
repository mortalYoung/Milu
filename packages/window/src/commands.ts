import { createServiceId, type Service } from "@milu/di";
import type { ComposerCommand } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

export type { ComposerCommand };

export class CommandRegistry implements Service {
	readonly store = createStore<{ commands: readonly ComposerCommand[] }>()(() => ({ commands: [] }));

	apply(commands: readonly ComposerCommand[]): void {
		const names = new Set<string>();
		for (const command of commands) {
			if (names.has(command.name)) throw new Error(`command "/${command.name}" is already contributed`);
			names.add(command.name);
		}
		this.store.setState({ commands }, true);
	}

	all(): readonly ComposerCommand[] {
		return this.store.getState().commands;
	}

	find(name: string): ComposerCommand | undefined {
		return this.store.getState().commands.find((command) => command.name === name);
	}

	dispose(): void {
		this.store.setState({ commands: [] }, true);
	}
}

export const CommandRegistryId = createServiceId<CommandRegistry>("CommandRegistry");
