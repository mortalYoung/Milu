import { createServiceId, type Service } from "@milu/di";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export interface OpenTargets {
	readonly editors: readonly { id: string; name: string }[];
	readonly finder: boolean;
}

/** What this machine has, and how to hand it a folder. Probed once per connection. */
export class OpenerService implements Service {
	readonly targets = new Store<OpenTargets>({ editors: [], finder: false });

	constructor(private readonly _connection: Connection) {}

	async load(): Promise<void> {
		this.targets.set(await this._connection.request("editors", {}));
	}

	async open(path: string, target: { editorId?: string; via?: "default" | "finder" } = {}): Promise<void> {
		const result = await this._connection.request("openPath", { path, ...target });
		if (!result.ok) console.warn("openPath:", result.error ?? path);
	}

	dispose(): void {
		this.targets.dispose();
	}
}

export const OpenerServiceId = createServiceId<OpenerService>("OpenerService");
