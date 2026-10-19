import { createServiceId, type Service } from "@milu/di";

import type { Connection } from "./connection.ts";

export class PickerService implements Service {
	constructor(private readonly _connection: Connection) {}

	async pick(startingFolder?: string): Promise<string | null> {
		const result = await this._connection.request("pickDirectory", startingFolder ? { startingFolder } : {});
		return result.path ?? null;
	}

	dispose(): void {}
}

export const PickerServiceId = createServiceId<PickerService>("PickerService");
