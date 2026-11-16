import { useEffect, useRef, useState, type RefObject } from "react";

export function useScrollEdges<T extends HTMLElement>(): readonly [RefObject<T | null>, string] {
	const ref = useRef<T>(null);
	const [edges, setEdges] = useState({ above: false, below: false });

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				frame = 0;
				setEdges({
					above: element.scrollTop > 2,
					below: element.scrollTop + element.clientHeight < element.scrollHeight - 2,
				});
			});
		};
		measure();
		element.addEventListener("scroll", measure, { passive: true });
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		const mutations = new MutationObserver(measure);
		mutations.observe(element, { subtree: true, childList: true, characterData: true });
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("scroll", measure);
			resize.disconnect();
			mutations.disconnect();
		};
	}, []);

	return [ref, `edge-fade${edges.above ? " has-above" : ""}${edges.below ? " has-below" : ""}`];
}
