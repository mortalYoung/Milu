import type { WidgetProps } from "@milu/client";
import { useEffect, useRef, useState } from "react";

import type { MeterWidgetData } from "../composer.ts";

import "./widgets.css";

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const formatTokens = (value: number): string => {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
};

export function MeterWidget(props: WidgetProps) {
	const data = props.data as MeterWidgetData | null;
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && root.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	if (!data) return null;

	const percent = data.percent;
	const reading = `context ${percent}% · ${formatTokens(data.used)} / ${formatTokens(data.window)}`;
	const level = percent > 90 ? "meter-danger" : percent > 60 ? "meter-warn" : "meter-ok";

	return (
		<span className="context-meter" ref={root}>
			<button type="button" className="context-meter-trigger" aria-label={reading} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
				<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
					<circle className="meter-track" cx="7" cy="7" r={RADIUS} />
					<circle className={`meter-fill ${level}`} cx="7" cy="7" r={RADIUS} strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`} transform="rotate(-90 7 7)" />
				</svg>
				{percent > 60 ? <span className="context-meter-percent">{percent}%</span> : null}
			</button>
			{open ? (
				<div className="context-meter-panel" role="dialog" aria-label="Context Usage">
					<div className="meter-headline">
						<span className="meter-title">
							~{formatTokens(data.used)} / {formatTokens(data.window)}
						</span>
						<span className="meter-percent">{percent}%</span>
					</div>
					<div className="meter-bar">
						<span className="meter-segment meter-messages" style={{ width: `${percent}%` }} />
					</div>
					<ul className="meter-rows">
						<li className="meter-row">
							<span className="meter-row-label">
								<span className="meter-swatch meter-messages" />
								context
							</span>
							<span className="meter-row-value">~{formatTokens(data.used)}</span>
						</li>
					</ul>
				</div>
			) : null}
		</span>
	);
}
