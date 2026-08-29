/**
 * ContextMeter — composer context-occupancy meter (modeled on deepseek-harness):
 * a 14px ring beside the send button fed by the provider-reported prompt size vs the
 * model's context window; click opens a panel with the exact percent, a segmented bar
 * and the heuristic composition (system / tools / messages, labeled `~` — deliberately
 * never reconciled with the provider-exact number).
 */
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { ContextUsage } from "../../shared/rpc";

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 1,234 → "1.2k"; 1,234,567 → "1.2M" */
function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(Math.round(n));
}

const ROWS = [
	{ key: "systemTokens", label: "system", color: "meter-system" },
	{ key: "toolsTokens", label: "tools", color: "meter-tools" },
	{ key: "messageTokens", label: "messages", color: "meter-messages" },
] as const;

const MIN_SEGMENT_PCT = 3;

export function ContextMeter(props: { usage: ContextUsage }) {
	const [open, setOpen] = createSignal(false);
	let rootRef: HTMLSpanElement | undefined;

	// Outside click / Escape close, one document listener while open.
	createEffect(() => {
		if (!open()) return;
		const onPointerDown = (e: PointerEvent) => {
			if (e.target instanceof Node && rootRef?.contains(e.target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		onCleanup(() => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		});
	});

	const percent = () => props.usage.percent;
	const usedTokens = () => props.usage.projectedTokens ?? props.usage.used;
	const reading = () => `context ${percent()}% · ${formatTokens(usedTokens())} / ${formatTokens(props.usage.window)}`;
	// Color levels: ≤60% brand seal, 60–90% amber, >90% red (visual warning near the ceiling).
	const level = () => (percent() > 90 ? "meter-danger" : percent() > 60 ? "meter-warn" : "meter-ok");
	// The ring always carries the reading; the numeric percent appears only past 60% (warn/danger
	// levels) — below that the arc alone is enough and the exact number lives in the click panel.

	const segments = () => {
		const b = props.usage.breakdown;
		if (!b) return [{ key: "total", color: "", width: percent() }];
		const total = b.systemTokens + b.toolsTokens + b.messageTokens;
		if (total === 0) return [{ key: "total", color: "", width: percent() }];
		const raw = ROWS.map((row) => ({
			key: row.key,
			color: row.color,
			width: (percent() * b[row.key]) / total,
		})).filter((s) => s.width > 0);
		if (raw.length <= 1) return raw;
		const raised = raw.map((s) => ({ ...s, width: Math.max(s.width, MIN_SEGMENT_PCT) }));
		const sum = raised.reduce((acc, s) => acc + s.width, 0);
		if (sum > 100) {
			const scale = 100 / sum;
			return raised.map((s) => ({ ...s, width: s.width * scale }));
		}
		return raised;
	};

	return (
		<span ref={rootRef} class="context-meter">
			<button type="button" class="context-meter-trigger" aria-label={reading()} aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen((v) => !v)}>
				<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
					<circle class="meter-track" cx="7" cy="7" r={RADIUS} />
					<circle class={`meter-fill ${level()}`} cx="7" cy="7" r={RADIUS} stroke-dasharray={`${(CIRCUMFERENCE * percent()) / 100} ${CIRCUMFERENCE}`} transform="rotate(-90 7 7)" />
				</svg>
				<Show when={percent() > 60}>
					<span class="context-meter-percent">{percent()}%</span>
				</Show>
			</button>
			<Show when={open()}>
				<div class="context-meter-panel" role="dialog" aria-label="Context usage">
					<div class="meter-headline">
						<span class="meter-title">
							~{formatTokens(usedTokens())} / {formatTokens(props.usage.window)}
						</span>
						<span class="meter-percent">{percent()}%</span>
					</div>
					<div class="meter-bar">
						{segments().map((s) => (
							<span class={`meter-segment ${s.color}`} style={{ width: `${s.width}%` }} />
						))}
					</div>
					<ul class="meter-rows">
						{ROWS.map((row) => {
							const value = props.usage.breakdown?.[row.key] ?? 0;
							return (
								<li class="meter-row">
									<span class="meter-row-label">
										<span class={`meter-swatch ${row.color}`} />
										{row.label}
									</span>
									<span class="meter-row-value">~{formatTokens(value)}</span>
								</li>
							);
						})}
					</ul>
				</div>
			</Show>
		</span>
	);
}
