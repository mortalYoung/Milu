import { createStore } from "zustand/vanilla";

import { createServiceId, type FrontEndService, type SelectionService, SelectionServiceId, type Service } from "../../host/index.ts";

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

export const RepliesServiceId = createServiceId<RepliesService>("replies.state");

export const services: readonly FrontEndService[] = [{ id: RepliesServiceId, create: (container) => new RepliesService(container.get(SelectionServiceId)) }];
