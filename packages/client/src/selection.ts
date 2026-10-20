import { createServiceId, type Service } from "@milu/di";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export class SelectionService implements Service {
	readonly selected = new Store("");

	constructor(private readonly _connection: Connection) {}

	async select(name: string): Promise<void> {
		const result = await this._connection.request("select", { session: name === "" ? null : name });
		this.apply(result.selected);
	}

	apply(selected: string | null): void {
		this.selected.set(selected ?? "");
	}

	dispose(): void {
		this.selected.dispose();
	}
}

export const SelectionServiceId = createServiceId<SelectionService>("SelectionService");
