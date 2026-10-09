import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function usePresence(open: boolean, exitMs: number) {
	const [visible, setVisible] = useState(open);
	const [leaving, setLeaving] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		clearTimeout(timer.current);
		if (open) {
			setVisible(true);
			setLeaving(false);
			return;
		}
		if (!visible) return;
		setLeaving(true);
		timer.current = setTimeout(
			() => {
				setVisible(false);
				setLeaving(false);
			},
			prefersReducedMotion() ? 0 : exitMs,
		);
	}, [open, exitMs, visible]);

	useEffect(() => () => clearTimeout(timer.current), []);

	return { visible, leaving };
}

export const DOCK_EXIT_MS = 140;
