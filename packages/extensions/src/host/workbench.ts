import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

export class WorkbenchService implements Service {
	readonly store = createStore<{ searchOpen: boolean }>()(() => ({ searchOpen: false }));

	setSearch(open: boolean): void {
		if (this.store.getState().searchOpen === open) return;
		this.store.setState({ searchOpen: open }, true);
	}

	dispose(): void {}
}

export const WorkbenchServiceId = createServiceId<WorkbenchService>("WorkbenchService");
