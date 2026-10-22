import { createServiceId, type Service } from "@milu/di";

import type { Connection } from "./connection.ts";
import type { DialogService } from "./dialogs.ts";

export interface BrowserCommands {
	readonly copy?: (text: string) => void | Promise<void>;
	readonly shell?: (on: boolean | "toggle") => void | Promise<void>;
}

export class ActionsService implements Service {
	constructor(
		private readonly _connection: Connection,
		private readonly _dialogService: DialogService,
		private readonly _commands: BrowserCommands,
	) {}

	async invoke(action: string, session?: string, args?: unknown): Promise<void> {
		let result = await this._send(action, session, args, false);
		if (!result.ok) throw new Error(result.error ?? `action "${action}" failed`);

		if (result.confirm) {
			if (!(await this._dialogService.confirm(result.confirm))) return;
			result = await this._send(action, session, args, true);
			if (!result.ok) throw new Error(result.error ?? `action "${action}" failed`);
		}

		const command = result.command;
		if (!command) return;

		if (command.kind === "shell") {
			await this._commands.shell?.(command.on);
			return;
		}

		await this._commands.copy?.(command.text);
	}

	dispose(): void {}

	private _send(action: string, session: string | undefined, args: unknown, confirmed: boolean) {
		return this._connection.request("invoke", {
			action,
			...(session ? { session } : {}),
			...(args === undefined ? {} : { args }),
			...(confirmed ? { confirmed } : {}),
		});
	}
}

export const ActionsServiceId = createServiceId<ActionsService>("ActionsService");
