import { useEffect, useRef, useState } from "react";
import type { ContextUsage } from "../../shared/rpc";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { formatTokens } from "../lib/utils";

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ROWS = [
	{ key: "systemTokens", label: "system", color: "meter-system" },
	{ key: "toolsTokens", label: "tools", color: "meter-tools" },
	{ key: "messageTokens", label: "messages", color: "meter-messages" },
] as const;

const MIN_SEGMENT_PCT = 3;

export function ContextMeter(props: { usage: ContextUsage }) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLSpanElement>(null);

	useEscapeLayer({ id: "composer.meter", order: ESCAPE_ORDER.meter, isOpen: () => open, close: () => setOpen(false) });

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const percent = props.usage.percent;
	const usedTokens = props.usage.projectedTokens ?? props.usage.used;
	const reading = `context ${percent}% · ${formatTokens(usedTokens)} / ${formatTokens(props.usage.window)}`;
	const level = percent > 90 ? "meter-danger" : percent > 60 ? "meter-warn" : "meter-ok";

	const breakdown = props.usage.breakdown;
	const segments = (() => {
		if (!breakdown) return [{ key: "total", color: "", width: percent }];
		const total = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
		if (total === 0) return [{ key: "total", color: "", width: percent }];
		const raw = ROWS.map((row) => ({ key: row.key as string, color: row.color as string, width: (percent * breakdown[row.key]) / total })).filter((segment) => segment.width > 0);
		if (raw.length <= 1) return raw;
		const raised = raw.map((segment) => ({ ...segment, width: Math.max(segment.width, MIN_SEGMENT_PCT) }));
		const sum = raised.reduce((acc, segment) => acc + segment.width, 0);
		if (sum > 100) {
			const scale = 100 / sum;
			return raised.map((segment) => ({ ...segment, width: segment.width * scale }));
		}
		return raised;
	})();

	return (
		<span ref={rootRef} className="context-meter">
			<button type="button" className="context-meter-trigger" aria-label={reading} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
				<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
					<circle className="meter-track" cx="7" cy="7" r={RADIUS} />
					<circle className={`meter-fill ${level}`} cx="7" cy="7" r={RADIUS} strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`} transform="rotate(-90 7 7)" />
				</svg>
				{percent > 60 && <span className="context-meter-percent">{percent}%</span>}
			</button>
			{open && (
				<div className="context-meter-panel" role="dialog" aria-label="Context usage">
					<div className="meter-headline">
						<span className="meter-title">
							~{formatTokens(usedTokens)} / {formatTokens(props.usage.window)}
						</span>
						<span className="meter-percent">{percent}%</span>
					</div>
					<div className="meter-bar">
						{segments.map((segment) => (
							<span key={segment.key} className={`meter-segment ${segment.color}`} style={{ width: `${segment.width}%` }} />
						))}
					</div>
					<ul className="meter-rows">
						{ROWS.map((row) => {
							const value = breakdown?.[row.key] ?? 0;
							return (
								<li className="meter-row" key={row.key}>
									<span className="meter-row-label">
										<span className={`meter-swatch ${row.color}`} />
										{row.label}
									</span>
									<span className="meter-row-value">~{formatTokens(value)}</span>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</span>
	);
}
