import { createServiceId, type Service } from "@milu/di";

import type { Connection } from "./connection.ts";

export interface BrowserCommands {
	readonly copy?: (text: string) => void | Promise<void>;
	readonly select?: (session: string) => void | Promise<void>;
	readonly shell?: (on: boolean | "toggle") => void | Promise<void>;
}

export class ActionsService implements Service {
	constructor(
		private readonly _connection: Connection,
		private readonly _commands: BrowserCommands,
	) {}

	async invoke(action: string, session?: string, args?: unknown): Promise<void> {
		const result = await this._connection.request("invoke", { action, ...(session ? { session } : {}), ...(args === undefined ? {} : { args }) });
		if (!result.ok) throw new Error(result.error ?? `action "${action}" failed`);

		const command = result.command;
		if (!command) return;

		if (command.kind === "select") {
			await this._commands.select?.(command.session);
			return;
		}

		if (command.kind === "shell") {
			await this._commands.shell?.(command.on);
			return;
		}

		await this._commands.copy?.(command.text);
	}

	dispose(): void {}
}

export const ActionsServiceId = createServiceId<ActionsService>("ActionsService");
