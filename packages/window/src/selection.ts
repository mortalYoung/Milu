import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

import { type Connection, IConnection } from "./connection.ts";

export class SelectionService implements Service {
	readonly store = createStore<{ selected: string }>()(() => ({ selected: "" }));

	constructor(@IConnection private readonly _connection: Connection) {}

	async select(name: string): Promise<void> {
		const result = await this._connection.request("select", { session: name === "" ? null : name });
		this.apply(result.selected);
	}

	apply(selected: string | null): void {
		const next = selected ?? "";
		if (this.store.getState().selected === next) return;
		this.store.setState({ selected: next }, true);
	}

	dispose(): void {}
}

export const ISelectionService = createServiceId<SelectionService>("SelectionService");
