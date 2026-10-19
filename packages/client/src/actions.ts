import { createServiceId, type Service } from "@milu/di";
import type { BrowserCommand } from "@milu/protocol";

import type { Connection } from "./connection.ts";

export type BrowserCommands = {
	readonly [K in BrowserCommand["kind"]]?: (command: Extract<BrowserCommand, { kind: K }>) => void | Promise<void>;
};

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
		const run = this._commands[command.kind] as ((command: BrowserCommand) => void | Promise<void>) | undefined;
		await run?.(command);
	}

	dispose(): void {}
}

export const ActionsServiceId = createServiceId<ActionsService>("ActionsService");
