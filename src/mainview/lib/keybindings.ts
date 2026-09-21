import { useEffect, useRef } from "react";

export interface Keybinding {
	key: string;
	meta?: boolean;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	handler: (event: KeyboardEvent) => void;
}

function matches(event: KeyboardEvent, binding: Keybinding): boolean {
	if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;
	if ((binding.meta ?? false) !== event.metaKey) return false;
	if ((binding.ctrl ?? false) !== event.ctrlKey) return false;
	if ((binding.shift ?? false) !== event.shiftKey) return false;
	if ((binding.alt ?? false) !== event.altKey) return false;
	return true;
}

export function useKeybindings(bindings: Keybinding[]) {
	const latest = useRef(bindings);
	latest.current = bindings;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) return;
			for (const binding of latest.current) {
				if (!matches(event, binding)) continue;
				try {
					binding.handler(event);
				} finally {
					if (!event.defaultPrevented) event.preventDefault();
				}
				return;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
