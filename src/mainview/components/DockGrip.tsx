import { createSignal, onCleanup, Show } from "solid-js";
import { cn } from "../lib/utils";

export const GRIP_WIDTH = 7;

export function clampPaneWidth(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

/**
 * The divider between two panes of a dock. Dragging is 1:1 (pointer capture, no animation) and the
 * width is only committed on release; the arrow keys do the same job for keyboard users.
 */
export function DockGrip(props: {
	host: () => HTMLElement | undefined;
	width: () => number;
	min: number;
	max: number;
	/** Which edge of the row the resized pane sits on — it decides which way the pointer grows it. */
	side: "left" | "right";
	label: string;
	class?: string;
	onResize: (width: number) => void;
	onCommit: () => void;
}) {
	const [readout, setReadout] = createSignal<string | null>(null);
	let origin: { x: number; width: number } | null = null;

	onCleanup(() => document.body.classList.remove("pane-dragging"));

	const report = (width: number) => {
		const total = props.host()?.clientWidth ?? 0;
		return `${Math.round(width)} / ${Math.max(0, Math.round(total - width - GRIP_WIDTH))}`;
	};
	const step = (width: number, direction: number) => clampPaneWidth(width + direction * 16, props.min, props.max);

	function onPointerDown(e: PointerEvent) {
		if (e.currentTarget instanceof HTMLElement) e.currentTarget.setPointerCapture(e.pointerId);
		origin = { x: e.clientX, width: props.width() };
		// Without this, dragging across a pane on the way selects its text.
		document.body.classList.add("pane-dragging");
		setReadout(report(props.width()));
	}
	function onPointerMove(e: PointerEvent) {
		if (!origin) return;
		const dragging = props.side === "right" ? origin.x - e.clientX : e.clientX - origin.x;
		const next = clampPaneWidth(origin.width + dragging, props.min, props.max);
		props.onResize(next);
		setReadout(report(next));
	}
	function onPointerUp(e: PointerEvent) {
		if (!origin) return;
		origin = null;
		setReadout(null);
		document.body.classList.remove("pane-dragging");
		if (e.currentTarget instanceof HTMLElement) e.currentTarget.releasePointerCapture(e.pointerId);
		props.onCommit();
	}
	function onKeyDown(e: KeyboardEvent) {
		const direction = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
		if (direction === 0) return;
		e.preventDefault();
		const widening = props.side === "right" ? direction : -direction;
		props.onResize(step(props.width(), widening));
		props.onCommit();
	}

	return (
		<div
			class={cn("dock-grip", props.class)}
			classList={{ dragging: readout() != null }}
			role="separator"
			aria-orientation="vertical"
			aria-label={props.label}
			aria-valuemin={props.min}
			aria-valuemax={props.max}
			aria-valuenow={props.width()}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onKeyDown={onKeyDown}
		>
			<i />
			<Show when={readout()}>{(value) => <span class="dock-grip-read">{value()}</span>}</Show>
		</div>
	);
}
