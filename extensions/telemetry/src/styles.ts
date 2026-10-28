export const STYLES = `
.milu-ext-telemetry {
	position: fixed;
	right: 18px;
	bottom: 18px;
	z-index: 50;
	font-family: var(--mono);
	font-size: 10px;
	line-height: 1.45;
	color: var(--ink);
}
.milu-ext-telemetry *,
.milu-ext-telemetry *::before,
.milu-ext-telemetry *::after {
	box-sizing: border-box;
}
.milu-ext-telemetry .telemetry-ball {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	padding: 0;
	border: 1px solid var(--line-strong);
	border-radius: 999px;
	background: var(--surface);
	color: var(--ink);
	box-shadow: 0 6px 20px color-mix(in srgb, var(--ink) 14%, transparent);
	cursor: pointer;
	transition:
		background-color 120ms var(--ease-out),
		transform 120ms var(--ease-out);
}
.milu-ext-telemetry .telemetry-ball:hover {
	background: var(--hover);
	transform: translateY(-1px);
}
.milu-ext-telemetry .telemetry-dot {
	position: absolute;
	top: -1px;
	right: -1px;
	width: 8px;
	height: 8px;
	border: 1.5px solid var(--surface);
	border-radius: 999px;
	background: var(--accent-teal);
}
.milu-ext-telemetry .telemetry-dot[data-tone="warn"],
.milu-ext-telemetry .telemetry-live[data-tone="warn"] {
	background: var(--accent-amber);
}
.milu-ext-telemetry .telemetry-dot[data-tone="danger"],
.milu-ext-telemetry .telemetry-live[data-tone="danger"] {
	background: var(--signal);
}
.milu-ext-telemetry .telemetry-panel {
	position: absolute;
	right: 0;
	bottom: calc(100% + 8px);
	width: min(320px, calc(100vw - 36px));
	overflow: hidden;
	border: 1px solid var(--line);
	border-radius: var(--r12);
	background: var(--surface);
	box-shadow: 0 12px 32px color-mix(in srgb, var(--ink) 16%, transparent);
	animation: telemetry-in 140ms var(--ease-out) both;
}
@keyframes telemetry-in {
	from {
		opacity: 0;
		transform: translateY(4px) scale(0.98);
	}
	to {
		opacity: 1;
		transform: none;
	}
}
.milu-ext-telemetry .telemetry-head {
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 9px 12px;
	border-bottom: 1px solid var(--line);
}
.milu-ext-telemetry .telemetry-live {
	width: 7px;
	height: 7px;
	border-radius: 999px;
	background: var(--accent-teal);
}
.milu-ext-telemetry .telemetry-title {
	font-family: var(--sans);
	font-size: 10.5px;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
}
.milu-ext-telemetry .telemetry-badge {
	padding: 0 5px;
	border: 1px solid var(--line);
	border-radius: 999px;
	color: var(--muted);
	font-size: 8.5px;
	letter-spacing: 0.08em;
}
.milu-ext-telemetry .telemetry-close {
	margin-left: auto;
	width: 20px;
	height: 20px;
	padding: 0;
	border: 0;
	border-radius: var(--r4);
	background: transparent;
	color: var(--muted);
	font: inherit;
	font-size: 14px;
	line-height: 1;
	cursor: pointer;
}
.milu-ext-telemetry .telemetry-close:hover {
	background: var(--hover);
	color: var(--ink);
}
.milu-ext-telemetry .telemetry-tabs {
	display: flex;
	gap: 2px;
	padding: 8px 8px 0;
}
.milu-ext-telemetry .telemetry-tab {
	flex: 1;
	padding: 5px 6px;
	border: 0;
	border-radius: var(--r6);
	background: transparent;
	color: var(--muted);
	font: inherit;
	font-size: 10px;
	cursor: pointer;
	transition:
		background-color 120ms var(--ease-out),
		color 120ms var(--ease-out);
}
.milu-ext-telemetry .telemetry-tab:hover {
	color: var(--ink);
}
.milu-ext-telemetry .telemetry-tab[data-active="true"] {
	background: var(--selected);
	color: var(--ink);
}
.milu-ext-telemetry .telemetry-body {
	display: flex;
	flex-direction: column;
	gap: 9px;
	padding: 10px 12px 12px;
}
.milu-ext-telemetry .telemetry-hero {
	display: flex;
	align-items: baseline;
	gap: 6px;
}
.milu-ext-telemetry .telemetry-value {
	font-family: var(--serif);
	font-size: 28px;
	font-weight: 600;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}
.milu-ext-telemetry .telemetry-value[data-tone="warn"] {
	color: var(--accent-amber);
}
.milu-ext-telemetry .telemetry-value[data-tone="danger"] {
	color: var(--signal);
}
.milu-ext-telemetry .telemetry-unit {
	color: var(--muted);
	font-size: 10px;
}
.milu-ext-telemetry .telemetry-chart {
	display: block;
	width: 100%;
	height: 34px;
	overflow: visible;
}
.milu-ext-telemetry .telemetry-chart polyline {
	fill: none;
	stroke: var(--ink);
	stroke-width: 1.5;
	vector-effect: non-scaling-stroke;
}
.milu-ext-telemetry .telemetry-rows {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.milu-ext-telemetry .telemetry-row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	color: var(--muted);
	font-variant-numeric: tabular-nums;
}
.milu-ext-telemetry .telemetry-row b {
	overflow: hidden;
	color: var(--ink);
	font-weight: 500;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.milu-ext-telemetry .telemetry-bar {
	height: 4px;
	overflow: hidden;
	border-radius: 999px;
	background: color-mix(in srgb, var(--line) 60%, transparent);
}
.milu-ext-telemetry .telemetry-bar > i {
	display: block;
	height: 100%;
	border-radius: 999px;
	background: var(--ink-soft);
	transition: width 300ms var(--ease-out);
}
.milu-ext-telemetry .telemetry-foot {
	display: flex;
	gap: 6px;
	padding: 0 12px 12px;
}
.milu-ext-telemetry .telemetry-button {
	flex: 1;
	padding: 5px 8px;
	border: 1px solid var(--line);
	border-radius: var(--r6);
	background: transparent;
	color: var(--muted);
	font: inherit;
	font-size: 10px;
	cursor: pointer;
	transition:
		background-color 120ms var(--ease-out),
		color 120ms var(--ease-out);
}
.milu-ext-telemetry .telemetry-button:hover {
	background: var(--hover);
	color: var(--ink);
}
@media (prefers-reduced-motion: reduce) {
	.milu-ext-telemetry .telemetry-panel {
		animation: none;
	}
	.milu-ext-telemetry .telemetry-ball,
	.milu-ext-telemetry .telemetry-tab,
	.milu-ext-telemetry .telemetry-button,
	.milu-ext-telemetry .telemetry-bar > i {
		transition: none;
	}
}
`;
