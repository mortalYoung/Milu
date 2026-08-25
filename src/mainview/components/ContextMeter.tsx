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
	const reading = () => `context ${percent()}% · ${formatTokens(props.usage.used)} / ${formatTokens(props.usage.window)}`;
	// Color levels: ≤60% brand seal, 60–90% amber, >90% red (visual warning near the ceiling).
	const level = () => (percent() > 90 ? "meter-danger" : percent() > 60 ? "meter-warn" : "meter-ok");
	// The ring always carries the reading; the numeric percent appears only past 60% (warn/danger
	// levels) — below that the arc alone is enough and the exact number lives in the click panel.

	// The bar's overall length stays the provider-exact percent; the heuristic
	// breakdown only proportions its colored parts. Zero-width parts are dropped
	// instead of rendered (a min-width hairline would draw a filled bar at 0%).
	const segments = () => {
		const b = props.usage.breakdown;
		const total = b ? b.systemTokens + b.toolsTokens + b.messageTokens : 0;
		if (!b || total === 0) return [{ key: "total", color: "", width: percent() }];
		return ROWS.map((row) => ({
			key: row.key,
			color: row.color,
			width: (percent() * b[row.key]) / total,
		})).filter((s) => s.width > 0);
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
							~{formatTokens(props.usage.used)} / {formatTokens(props.usage.window)}
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
									<span class={`meter-swatch ${row.color}`} />
									<span class="meter-row-label">{row.label}</span>
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
