import { createServiceId, type Service } from "@milu/di";
import type { WelcomeItem } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export class WelcomeService implements Service {
	readonly items = new Store<readonly WelcomeItem[]>([]);

	constructor(private readonly _connection: Connection) {}

	async load(): Promise<void> {
		this.items.set((await this._connection.request("welcome", {})).items);
	}

	dispose(): void {
		this.items.dispose();
	}
}

export const WelcomeServiceId = createServiceId<WelcomeService>("WelcomeService");
