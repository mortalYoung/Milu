import { createServiceId, type Service } from "@milu/di";

import { type Connection, IConnection } from "./connection.ts";

export class PickerService implements Service {
	constructor(@IConnection private readonly _connection: Connection) {}

	async pick(startingFolder?: string): Promise<string | null> {
		const result = await this._connection.request("pickDirectory", startingFolder ? { startingFolder } : {});
		return result.path ?? null;
	}

	dispose(): void {}
}

export const IPickerService = createServiceId<PickerService>("PickerService");
