import { createSignal } from "solid-js";
import { useSession } from "./contexts/session-context";

/** A text the palette (or anything else outside the composer) wants typed into the live input. */
export interface ComposerPrefill {
	id: number;
	partner: string | null;
	text: string;
}

export function createComposer() {
	const { data } = useSession();
	const [drafts, setDrafts] = createSignal<Record<string, string>>({});
	const [pendingPrefill, setPendingPrefill] = createSignal<ComposerPrefill | null>(null);
	const [panelOpen, setPanelOpen] = createSignal(false);
	let prefillSeq = 0;

	function change(text: string) {
		const name = data.selected;
		if (!name) return;
		setDrafts((d) => ({ ...d, [name]: text }));
	}

	function clear(name: string) {
		setDrafts((d) => {
			const { [name]: _drop, ...rest } = d;
			return rest;
		});
	}

	function prefill(text: string) {
		prefillSeq += 1;
		setPendingPrefill({ id: prefillSeq, partner: data.selected, text });
	}

	/** A prefill is a one-shot: the composer that took it says so, so a remount cannot replay it. */
	function consumePrefill(id: number) {
		if (pendingPrefill()?.id === id) setPendingPrefill(null);
	}

	return { drafts, change, clear, prefill, pendingPrefill, consumePrefill, panelOpen, setPanelOpen };
}
