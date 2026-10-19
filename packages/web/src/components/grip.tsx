import { useRef } from "react";

export function Grip(props: { onDrag: (delta: number) => void; onReset: () => void }) {
	const start = useRef<{ x: number; moved: number } | null>(null);

	return (
		<div
			className="grip"
			role="separator"
			aria-orientation="vertical"
			onDoubleClick={props.onReset}
			onPointerDown={(event) => {
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				start.current = { x: event.clientX, moved: 0 };
			}}
			onPointerMove={(event) => {
				const origin = start.current;
				if (!origin) return;
				const delta = event.clientX - origin.x - origin.moved;
				if (delta === 0) return;
				origin.moved += delta;
				props.onDrag(delta);
			}}
			onPointerUp={(event) => {
				start.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
		/>
	);
}
