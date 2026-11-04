import { createServiceId, type Service } from "@milu/di";
import type { ComposerCommand } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

import { IConnection, type Connection } from "./connection.ts";

export type { ComposerCommand };

const EMPTY: readonly ComposerCommand[] = [];

export class CommandRegistry implements Service {
	readonly store = createStore<{ commands: readonly ComposerCommand[] }>()(() => ({ commands: EMPTY }));

	constructor(@IConnection private readonly _connection: Connection) {}

	apply(commands: readonly ComposerCommand[]): void {
		const names = new Set<string>();
		for (const command of commands) {
			if (names.has(command.name)) throw new Error(`command "/${command.name}" is already contributed`);
			names.add(command.name);
		}
		this.store.setState({ commands }, true);
	}

	async load(session: string): Promise<void> {
		if (!session) {
			this.store.setState({ commands: EMPTY }, true);
			return;
		}
		try {
			const { commands } = await this._connection.request("commands", { session });
			this.apply(commands);
		} catch {}
	}

	all(): readonly ComposerCommand[] {
		return this.store.getState().commands;
	}

	find(name: string): ComposerCommand | undefined {
		return this.store.getState().commands.find((command) => command.name === name);
	}

	dispose(): void {
		this.store.setState({ commands: EMPTY }, true);
	}
}

export const CommandRegistryId = createServiceId<CommandRegistry>("CommandRegistry");
