import { createServiceId, type Service } from "@milu/di";
import type { ContributionItem } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export class HeaderService implements Service {
	readonly items = new Store<readonly ContributionItem[]>([]);

	constructor(private readonly _connection: Connection) {}

	async load(): Promise<void> {
		this.items.set((await this._connection.request("contributions", { point: "session.header" })).items);
	}

	dispose(): void {
		this.items.dispose();
	}
}

export const HeaderServiceId = createServiceId<HeaderService>("HeaderService");
