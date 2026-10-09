import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { clampPaneWidth, GRIP_WIDTH } from "../lib/grip";
import { cn } from "../lib/utils";

export { GRIP_WIDTH };

/** 悬停多久才把读数浮出来：先停一下再淡入，掠过边界不会闪一路数字 */
const HOVER_DELAY_MS = 350;

export function DockGrip(props: {
	width: () => number;
	min: number;
	max: number;
	side: "left" | "right";
	label: string;
	class?: string;
	half: () => number;
	/** 拖动中的读数：列出现在真的在屏上的那几个区（宽的是被拖的那个） */
	readout: (width: number) => string;
	onResize: (width: number) => void;
	onCommit: () => void;
}) {
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

	const step = (width: number, direction: number) => clampPaneWidth(width + direction * 16, props.min, props.max);
	const show = () => setReadout(props.readout(props.width()));
	const stopTimer = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};
	/* 移出/失焦直接卸载 —— 退场没有动画，只有进场（CSS 的 @starting-style）是淡入 */
	const hide = () => {
		stopTimer();
		if (!dragging) setReadout(null);
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId);
		origin.current = { x: event.clientX, width: props.width() };
		setDragging(true);
		document.body.classList.add("pane-dragging");
		/* 按下就直接给数：拖动的人不该等那 350ms */
		stopTimer();
		show();
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const start = origin.current;
		if (!start) return;
		const moved = props.side === "right" ? start.x - event.clientX : event.clientX - start.x;
		const next = clampPaneWidth(start.width + moved, props.min, props.max);
		props.onResize(next);
		setReadout(props.readout(next));
	};

	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (!origin.current) return;
		origin.current = null;
		setDragging(false);
		document.body.classList.remove("pane-dragging");
		if (event.currentTarget instanceof HTMLElement) event.currentTarget.releasePointerCapture(event.pointerId);
		props.onCommit();
		/* 松手时指针还在 grip 上就留着（顺手能读），已经跑远了就立刻收掉 */
		const box = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
		const inside = box != null && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
		if (!inside) setReadout(null);
	};

	const onPointerEnter = () => {
		if (readout != null || timer.current) return;
		timer.current = setTimeout(() => {
			timer.current = null;
			show();
		}, HOVER_DELAY_MS);
	};

	const onDoubleClick = () => {
		const target = props.half();
		if (target <= 0) return;
		props.onResize(clampPaneWidth(target, props.min, props.max));
		props.onCommit();
		setReadout(props.readout(clampPaneWidth(target, props.min, props.max)));
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const direction = event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0;
		if (direction === 0) return;
		event.preventDefault();
		const widening = props.side === "right" ? direction : -direction;
		const next = step(props.width(), widening);
		props.onResize(next);
		props.onCommit();
		setReadout(props.readout(next));
	};

	return (
		<div
			className={cn("dock-grip", props.class, readout != null && "revealed", dragging && "dragging")}
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
			onPointerEnter={onPointerEnter}
			onPointerLeave={hide}
			onFocus={show}
			onBlur={hide}
			onKeyDown={onKeyDown}
		>
			<i />
			{readout && <span className="dock-grip-read">{readout}</span>}
		</div>
	);
}
