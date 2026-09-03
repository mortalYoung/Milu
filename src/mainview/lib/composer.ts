import { createSignal } from "solid-js";
import { useSession } from "./contexts/session-context";

export function createComposer() {
	const { data } = useSession();
	const [drafts, setDrafts] = createSignal<Record<string, string>>({});

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

	return { drafts, change, clear };
}
