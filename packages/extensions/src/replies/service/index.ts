import { createServiceId, type Service } from "@milu/di";
import type { SelectionService } from "@milu/window/api";
import { createStore } from "zustand/vanilla";

export class RepliesService implements Service {
	readonly store = createStore<{ open: boolean }>()(() => ({ open: false }));

	private readonly _unsubscribe: () => void;

	constructor(selection: SelectionService) {
		this._unsubscribe = selection.store.subscribe(() => this.close());
	}

	toggle(): void {
		this.store.setState((state) => ({ ...state, open: !state.open }), true);
	}

	close(): void {
		if (!this.store.getState().open) return;
		this.store.setState((state) => ({ ...state, open: false }), true);
	}

	dispose(): void {
		this._unsubscribe();
	}
}

export const IRepliesService = createServiceId<RepliesService>("replies.state");
