import { createStore, type StoreApi } from "zustand/vanilla";
import type { SessionData } from "./session";

export interface ComposerPrefill {
	id: number;
	partner: string | null;
	text: string;
}

export function createComposer(session: StoreApi<SessionData>) {
	const store = createStore<{ drafts: Record<string, string>; pendingPrefill: ComposerPrefill | null; panelOpen: boolean }>()(() => ({
		drafts: {},
		pendingPrefill: null,
		panelOpen: false,
	}));
	let prefillSeq = 0;

	function change(text: string) {
		const name = session.getState().selected;
		if (!name) return;
		store.setState((state) => ({ drafts: { ...state.drafts, [name]: text } }));
	}

	function clear(name: string) {
		store.setState((state) => {
			const { [name]: _drop, ...rest } = state.drafts;
			return { drafts: rest };
		});
	}

	function prefill(text: string) {
		prefillSeq += 1;
		store.setState({ pendingPrefill: { id: prefillSeq, partner: session.getState().selected, text } });
	}

	function consumePrefill(id: number) {
		if (store.getState().pendingPrefill?.id === id) store.setState({ pendingPrefill: null });
	}

	return { store, change, clear, prefill, consumePrefill, setPanelOpen: (panelOpen: boolean) => store.setState({ panelOpen }) };
}
