import { useEffect, useRef, useState } from "react";

function reduceMotion(): boolean {
	return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AnimatedNumber(props: { value: number; format?: (value: number) => string; duration?: number }) {
	const [shown, setShown] = useState(props.value);
	const shownRef = useRef(props.value);

	useEffect(() => {
		const from = shownRef.current;
		const to = props.value;
		if (from === to || reduceMotion()) {
			shownRef.current = to;
			setShown(to);
			return;
		}
		const duration = props.duration ?? 600;
		const started = performance.now();
		let frame = 0;
		const tick = (now: number) => {
			const progress = Math.min(1, (now - started) / duration);
			const eased = 1 - (1 - progress) ** 3;
			const next = from + (to - from) * eased;
			shownRef.current = next;
			setShown(next);
			if (progress < 1) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [props.value, props.duration]);

	return <span>{props.format ? props.format(shown) : String(Math.round(shown))}</span>;
}
