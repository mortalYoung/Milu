import { createServiceId, type Service } from "@milu/di";
import type { LayoutState } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

export class LayoutService implements Service {
	readonly store = createStore<LayoutState>()(() => ({ surfaces: [], layout: {} }));

	set(state: LayoutState): void {
		this.store.setState(state, true);
	}

	dispose(): void {}
}

export const ILayoutService = createServiceId<LayoutService>("LayoutService");
