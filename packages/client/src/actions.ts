import { createServiceId, type Service } from "@milu/di";

import type { Connection } from "./connection.ts";

/** The one way to run a contributed command: an action id, and the session it is about. */
export class ActionsService implements Service {
	constructor(private readonly _connection: Connection) {}

	async invoke(action: string, session?: string): Promise<void> {
		const result = await this._connection.request("invoke", { action, ...(session ? { session } : {}) });
		if (!result.ok) throw new Error(result.error ?? `action "${action}" failed`);
	}

	dispose(): void {}
}

export const ActionsServiceId = createServiceId<ActionsService>("ActionsService");
