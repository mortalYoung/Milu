import { createSignal } from "solid-js";

/** Per-chat composer drafts: written on every keystroke, restored when the chat is re-selected. */
export function createComposer(getSelectedName: () => string | null) {
	const [drafts, setDrafts] = createSignal<Record<string, string>>({});

	function change(text: string) {
		const name = getSelectedName();
		if (!name) return;
		setDrafts((d) => ({ ...d, [name]: text }));
	}

	function clear(name: string) {
		setDrafts((d) => {
			const { [name]: _drop, ...rest } = d;
			return rest;
		});
	}

	return { drafts, change, clear };
}
