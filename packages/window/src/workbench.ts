import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

export class WorkbenchService implements Service {
	readonly store = createStore<{ searchOpen: boolean; view: string | null }>()(() => ({ searchOpen: false, view: null }));

	setSearch(open: boolean): void {
		if (this.store.getState().searchOpen === open) return;
		this.store.setState((state) => ({ ...state, searchOpen: open }), true);
	}

	showView(view: string | null): void {
		if (this.store.getState().view === view) return;
		this.store.setState((state) => ({ ...state, view }), true);
	}

	dispose(): void {}
}

export const IWorkbenchService = createServiceId<WorkbenchService>("WorkbenchService");
