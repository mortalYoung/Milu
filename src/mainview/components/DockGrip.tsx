import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { clampPaneWidth, GRIP_WIDTH } from "../lib/grip";
import { cn } from "../lib/utils";

export { GRIP_WIDTH };

export function DockGrip(props: {
	host: () => HTMLElement | null | undefined;
	width: () => number;
	min: number;
	max: number;
	side: "left" | "right";
	label: string;
	class?: string;
	half: () => number;
	onResize: (width: number) => void;
	onCommit: () => void;
}) {
	const [readout, setReadout] = useState<string | null>(null);
	const origin = useRef<{ x: number; width: number } | null>(null);

	useEffect(() => () => document.body.classList.remove("pane-dragging"), []);

	const report = (width: number) => {
		const total = props.host()?.clientWidth ?? 0;
		return `${Math.round(width)} / ${Math.max(0, Math.round(total - width - GRIP_WIDTH))}`;
	};
	const step = (width: number, direction: number) => clampPaneWidth(width + direction * 16, props.min, props.max);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
		origin.current = { x: event.clientX, width: props.width() };
		document.body.classList.add("pane-dragging");
		setReadout(report(props.width()));
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const start = origin.current;
		if (!start) return;
		const dragging = props.side === "right" ? start.x - event.clientX : event.clientX - start.x;
		const next = clampPaneWidth(start.width + dragging, props.min, props.max);
		props.onResize(next);
		setReadout(report(next));
	};

	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (!origin.current) return;
		origin.current = null;
		setReadout(null);
		document.body.classList.remove("pane-dragging");
		if (event.currentTarget instanceof HTMLElement) event.currentTarget.releasePointerCapture(event.pointerId);
		props.onCommit();
	};

	const onDoubleClick = () => {
		const target = props.half();
		if (target <= 0) return;
		props.onResize(clampPaneWidth(target, props.min, props.max));
		props.onCommit();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
		if (direction === 0) return;
		event.preventDefault();
		const widening = props.side === "right" ? direction : -direction;
		props.onResize(step(props.width(), widening));
		props.onCommit();
	};

	return (
		<div
			className={cn("dock-grip", props.class, readout != null && "dragging")}
			role="separator"
			aria-orientation="vertical"
			aria-label={props.label}
			aria-valuemin={props.min}
			aria-valuemax={props.max}
			aria-valuenow={props.width()}
			tabIndex={0}
			onDoubleClick={onDoubleClick}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onKeyDown={onKeyDown}
		>
			<i />
			{readout && <span className="dock-grip-read">{readout}</span>}
		</div>
	);
}
