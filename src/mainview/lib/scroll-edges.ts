import { useEffect, useRef, useState } from "react";
import { distanceToBottom } from "./scroll-anchor";

/** Sub-pixel layout must not flicker an edge on and off. */
const EDGE_PX = 2;

export interface ScrollEdges {
	/** Attach to the scrolling element. */
	ref: (element: HTMLElement | null) => void;
	/** Content continues above / below the visible area. */
	above: boolean;
	below: boolean;
}

/**
 * Which ways a scroller has more content. Measurement is pure geometry (`distanceToBottom`), and it
 * re-runs on scroll, on resize of the scroller itself, and whenever `deps` change — rows appearing or
 * disappearing changes what fits without changing the scroller's box.
 */
export function useScrollEdges(deps: unknown[] = []): ScrollEdges {
	const [element, setElement] = useState<HTMLElement | null>(null);
	const [edges, setEdges] = useState({ above: false, below: false });
	const measure = useRef<() => void>(() => {});

	useEffect(() => {
		if (!element) return;
		const read = () => {
			const next = {
				above: element.scrollTop > EDGE_PX,
				below: distanceToBottom(element.scrollHeight, element.scrollTop, element.clientHeight) > EDGE_PX,
			};
			setEdges((previous) => (previous.above === next.above && previous.below === next.below ? previous : next));
		};
		measure.current = read;
		read();
		element.addEventListener("scroll", read, { passive: true });
		const observer = new ResizeObserver(read);
		observer.observe(element);
		return () => {
			measure.current = () => {};
			element.removeEventListener("scroll", read);
			observer.disconnect();
		};
	}, [element]);

	useEffect(() => {
		measure.current();
	}, deps);

	return { ref: setElement, above: edges.above, below: edges.below };
}
