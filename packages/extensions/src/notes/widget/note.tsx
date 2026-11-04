import { oneLine, type ViewItem } from "@milu/window/api";
import { useEffect, useRef, useState, type RefObject } from "react";

function textWidth(element: HTMLElement, text: string): number {
	const style = getComputedStyle(element);
	const context = document.createElement("canvas").getContext("2d");
	if (!context) return 0;
	context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	return context.measureText(text).width;
}

/** Budget in characters, from the average width of the text itself: "M" is twice a Han glyph and wider than most letters, so neither fits everyone. */
function useBudget(ref: RefObject<HTMLElement | null>, text: string): number {
	const [budget, setBudget] = useState(0);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			const width = element.clientWidth;
			const line = oneLine(text);
			if (width <= 0 || line === "") return;
			const average = textWidth(element, line) / [...line].length;
			if (average > 0) setBudget(Math.max(8, Math.floor(width / average) - 2));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, text]);
	return budget;
}

/** One line, elided in the middle: the head says what it is about, the tail says where it got to. */
function middle(text: string, budget: number): { head: string; tail: string; elided: boolean } {
	const points = [...oneLine(text)];
	if (points.length <= budget) return { head: points.join(""), tail: "", elided: false };
	const keep = Math.max(0, budget - 1);
	return { head: points.slice(0, Math.ceil(keep / 2)).join(""), tail: points.slice(points.length - Math.floor(keep / 2)).join(""), elided: true };
}

function Middle(props: { text: string; budget: number }) {
	const parts = props.budget === 0 ? { head: oneLine(props.text), tail: "", elided: false } : middle(props.text, props.budget);
	if (!parts.elided) return <>{parts.head}</>;
	return (
		<>
			{parts.head}
			<span className="mx-1 text-ink">…</span>
			{parts.tail}
		</>
	);
}

/** A line that spends whatever room it is given and cuts out of its middle, keeping both ends readable. */
export function Elide(props: { text: string; className?: string }) {
	const line = useRef<HTMLSpanElement>(null);
	const budget = useBudget(line, props.text);
	return (
		<span ref={line} className={props.className}>
			<Middle text={props.text} budget={budget} />
		</span>
	);
}

export function NoteFallback(props: { item: ViewItem }) {
	const { item } = props;
	const label = item.tool ? item.tool.name : "thinking";
	const text = item.tool ? item.tool.summary : oneLine(item.thinking?.text ?? "");
	return (
		<div className="min-w-0 truncate font-mono text-[10px] leading-[1.7] text-muted">
			{label} {text}
		</div>
	);
}
