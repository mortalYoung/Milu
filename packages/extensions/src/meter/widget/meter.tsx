import { composerDataKey, LOG_EVENTS } from "@milu/protocol";
import { useComposerData, useComposerRefresh, type WidgetProps } from "@milu/window/api";
import { Tip } from "@milu/window/api/tooltip";
import { useEffect, useRef, useState } from "react";

import type { MeterWidgetData } from "../index.ts";

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const MIN_SEGMENT_PCT = 3;

const TONE = {
	ok: { stroke: "stroke-ink", text: "text-ink" },
	warn: { stroke: "stroke-accent-amber", text: "text-accent-amber" },
	danger: { stroke: "stroke-signal", text: "text-signal" },
} as const;

const ROWS = [
	{ key: "systemTokens", label: "system", color: "bg-ink" },
	{ key: "toolsTokens", label: "tools", color: "bg-[color-mix(in_srgb,var(--ink)_55%,transparent)]" },
	{ key: "messageTokens", label: "messages", color: "bg-[color-mix(in_srgb,var(--ink)_28%,transparent)]" },
] as const;

const formatTokens = (value: number): string => {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
};

function MeterPlaceholder(props: { readonly error: boolean }) {
	const label = props.error ? "Context usage unavailable" : "Loading context usage";
	return (
		<Tip label={label}>
			<span className="grid h-[26px] w-[26px] shrink-0 place-items-center" aria-busy={props.error ? undefined : true} aria-label={label}>
				<span className={`size-[14px] rounded-full border-2 ${props.error ? "border-dashed border-line" : "animate-pulse border-line motion-reduce:animate-none"}`} />
			</span>
		</Tip>
	);
}

export function MeterWidget(props: WidgetProps) {
	const { data, status, session, refresh } = useComposerData<MeterWidgetData | null>(props.host, composerDataKey("composer.right", "meter"));
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLSpanElement>(null);

	useComposerRefresh(
		props.host,
		session,
		refresh,
		(entry) =>
			(entry.type === "message" && entry.message.role === "assistant" && entry.message.usage !== undefined) ||
			(entry.type === "custom" && entry.customType === LOG_EVENTS.compaction),
	);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && root.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	if (!data) {
		if (status === "ready") return null;
		return <MeterPlaceholder error={status === "error"} />;
	}

	const percent = data.percent;
	const usedTokens = data.used;
	const reading = `Context ${percent}% · ${formatTokens(usedTokens)} / ${formatTokens(data.window)}`;
	const tone = TONE[percent > 90 ? "danger" : percent > 60 ? "warn" : "ok"];

	const breakdown = data.breakdown;
	const segments = (() => {
		if (!breakdown) return [{ key: "total", color: "bg-ink", width: percent }];
		const total = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
		if (total === 0) return [{ key: "total", color: "bg-ink", width: percent }];
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
		<span className="relative flex-none" ref={root}>
			<Tip label={open ? undefined : reading}>
				<button
					type="button"
					className={`flex h-[26px] min-w-[26px] shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full border-0 bg-transparent text-muted-soft transition-colors duration-150 hover:bg-hover hover:text-ink ${percent > 60 ? "pl-1 pr-1.5" : "px-1"} ${open ? "bg-selected text-ink" : ""}`}
					aria-label={reading}
					aria-haspopup="dialog"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					<svg viewBox="0 0 14 14" width="14" height="14" className="shrink-0" aria-hidden="true">
						<circle className="fill-none stroke-line [stroke-width:2]" cx="7" cy="7" r={RADIUS} />
						<circle
							className={`fill-none [stroke-width:2] [stroke-linecap:round] ${tone.stroke}`}
							cx="7"
							cy="7"
							r={RADIUS}
							strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`}
							transform="rotate(-90 7 7)"
						/>
					</svg>
					{percent > 60 ? <span className="font-mono text-[10px] leading-none tabular-nums">{percent}%</span> : null}
				</button>
			</Tip>
			{open ? (
				<div
					className="absolute right-0 bottom-[calc(100%+8px)] z-50 w-[236px] rounded-md border border-line bg-surface p-3 shadow-[0_8px_24px_color-mix(in_srgb,var(--ink)_12%,transparent)] animate-[menu-in_140ms_cubic-bezier(0.23,1,0.32,1)_both] motion-reduce:animate-none"
					role="dialog"
					aria-label="Context usage"
				>
					<div className="mb-2 flex items-baseline justify-between gap-2">
						<span className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Context</span>
						<span className={`font-serif text-[16px] leading-none font-semibold ${tone.text}`}>{percent}%</span>
					</div>
					<div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--line)_60%,transparent)]">
						{segments.map((segment) => (
							<span key={segment.key} className={`block h-full min-w-0 rounded-full transition-[width] duration-200 ${segment.color}`} style={{ width: `${segment.width}%` }} />
						))}
					</div>
					<p className="mt-1.5 mb-2 font-mono text-[10px] tabular-nums text-muted">
						~{formatTokens(usedTokens)} / {formatTokens(data.window)}
					</p>
					<ul className="flex flex-col gap-1">
						{ROWS.map((row) => (
							<li key={row.key} className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums text-muted">
								<span className="flex items-center gap-1.5">
									<span className={`size-2 rounded-full ${row.color}`} />
									{row.label}
								</span>
								<span>~{formatTokens(breakdown?.[row.key] ?? 0)}</span>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</span>
	);
}

export default MeterWidget;
