import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Keeps a panel mounted through its exit animation: `visible` gates the render, `leaving` plays the exit. */
export function createPresence(open: () => boolean, exitMs: number) {
	const [visible, setVisible] = createSignal(open());
	const [leaving, setLeaving] = createSignal(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	createEffect(() => {
		clearTimeout(timer);
		if (open()) {
			setVisible(true);
			setLeaving(false);
			return;
		}
		if (!untrack(visible)) return;
		setLeaving(true);
		timer = setTimeout(
			() => {
				setVisible(false);
				setLeaving(false);
			},
			prefersReducedMotion() ? 0 : exitMs,
		);
	});

	onCleanup(() => clearTimeout(timer));
	return { visible, leaving };
}

export const DOCK_EXIT_MS = 150;
export const DOCK_POPOVER_EXIT_MS = 120;
