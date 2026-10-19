import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

const HOVER_DELAY_MS = 350;
const STEP = 16;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export interface GripProps {
	readonly width: () => number;
	readonly min: number;
	readonly max: number;
	readonly side: "left" | "right";
	readonly label: string;
	readonly variant: "list" | "dock";
	readonly readout: (width: number) => string;
	readonly onResize: (width: number) => void;
	readonly onReset: () => number;
}

export function Grip(props: GripProps) {
	const [readout, setReadout] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const origin = useRef<{ x: number; width: number } | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			document.body.classList.remove("pane-dragging");
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const stopTimer = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};

	const show = (width: number) => setReadout(props.readout(width));

	const hide = () => {
		stopTimer();
		if (!dragging) setReadout(null);
	};

	const settle = (width: number) => {
		props.onResize(width);
		show(width);
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		origin.current = { x: event.clientX, width: props.width() };
		setDragging(true);
		document.body.classList.add("pane-dragging");
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			origin.current = null;
		}
		stopTimer();
		show(props.width());
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const start = origin.current;
		if (!start) return;
		const moved = props.side === "right" ? start.x - event.clientX : event.clientX - start.x;
		settle(clamp(start.width + moved, props.min, props.max));
	};

	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (!origin.current) return;
		origin.current = null;
		setDragging(false);
		document.body.classList.remove("pane-dragging");
		event.currentTarget.releasePointerCapture(event.pointerId);
		const box = event.currentTarget.getBoundingClientRect();
		const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
		if (!inside) setReadout(null);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
		if (direction === 0) return;
		event.preventDefault();
		const widening = props.side === "right" ? direction : -direction;
		settle(clamp(props.width() + widening * STEP, props.min, props.max));
	};

	const revealed = readout !== null;

	return (
		<div
			className={`grip grip-${props.variant}${revealed ? " revealed" : ""}${dragging ? " dragging" : ""}`}
			role="separator"
			aria-orientation="vertical"
			aria-label={props.label}
			aria-valuemin={props.min}
			aria-valuemax={props.max}
			aria-valuenow={Math.round(props.width())}
			tabIndex={0}
			onDoubleClick={() => settle(props.onReset())}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onPointerEnter={() => {
				if (readout !== null || timer.current) return;
				timer.current = setTimeout(() => {
					timer.current = null;
					show(props.width());
				}, HOVER_DELAY_MS);
			}}
			onPointerLeave={hide}
			onFocus={() => show(props.width())}
			onBlur={hide}
			onKeyDown={onKeyDown}
		>
			<i />
			{readout !== null ? <span className="grip-read">{readout}</span> : null}
		</div>
	);
}
