import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

export function AnimatedNumber(props: { value: number; format: (value: number) => string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const shown = useRef(0);
	const reduced = useReducedMotion();

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const from = shown.current;
		shown.current = props.value;
		if (reduced || from === props.value) {
			node.textContent = props.format(props.value);
			return;
		}
		const controls = animate(from, props.value, {
			duration: 0.45,
			ease: "easeOut",
			onUpdate: (value) => {
				node.textContent = props.format(value);
			},
		});
		return () => controls.stop();
	}, [props.value, props.format, reduced]);

	return <span ref={ref}>{props.format(props.value)}</span>;
}
