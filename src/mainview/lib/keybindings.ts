import { onCleanup } from "solid-js";

export interface Keybinding {
	key: string;
	meta?: boolean;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	handler: (event: KeyboardEvent) => void;
}

function matches(e: KeyboardEvent, b: Keybinding): boolean {
	if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;
	if ((b.meta ?? false) !== e.metaKey) return false;
	if ((b.ctrl ?? false) !== e.ctrlKey) return false;
	if ((b.shift ?? false) !== e.shiftKey) return false;
	if ((b.alt ?? false) !== e.altKey) return false;
	return true;
}

/** Register app-wide keyboard shortcuts; handlers run once per non-repeat keydown. */
export function useKeybindings(bindings: Keybinding[]) {
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.repeat) return;
		for (const binding of bindings) {
			if (!matches(e, binding)) continue;
			// The handler runs before the default is blocked: a handler that only listens (Esc) has to see
			// whether something above it already took the key, and `preventDefault` is itself the signal.
			try {
				binding.handler(e);
			} finally {
				if (!e.defaultPrevented) e.preventDefault();
			}
			return;
		}
	};

	window.addEventListener("keydown", onKeyDown);
	onCleanup(() => window.removeEventListener("keydown", onKeyDown));
}
