import { createMemo, createSignal, For, Show } from "solid-js";

/**
 * The dashboard's plot: one or two 1.5px lines over a hairline grid, an end marker in seal, and a readout
 * that follows the pointer. No animation on the data itself — the reference page, and every chart that
 * means to be read rather than watched, keeps the ink still and moves only the readout.
 */

export interface DashboardSeries {
	label: string;
	values: number[];
	/** Appended to the value in the readout and in the aria label. */
	unit?: string;
	/** Rendered in the muted ink, under the primary line. */
	muted?: boolean;
}

const PAD = { l: 34, r: 10, t: 10, b: 18 };
const GRID_LINES = 4;

function nice(max: number): number {
	if (max <= 0) return 1;
	const step = 10 ** Math.floor(Math.log10(max));
	for (const factor of [1, 1.5, 2, 2.5, 5, 10]) {
		if (max <= step * factor) return step * factor;
	}
	return step * 10;
}

export function DashboardChart(props: { labels: string[]; series: DashboardSeries[]; height?: number; format?: (value: number) => string }) {
	const [hover, setHover] = createSignal<number | null>(null);
	const width = 320;
	const height = () => props.height ?? 150;
	const scale = createMemo(() => nice(Math.max(...props.series.flatMap((line) => line.values), 1)));
	const xAt = (index: number) => PAD.l + (index / Math.max(1, props.labels.length - 1)) * (width - PAD.l - PAD.r);
	const yAt = (value: number) => height() - PAD.b - (value / scale()) * (height() - PAD.t - PAD.b);
	const ticks = createMemo(() => Array.from({ length: GRID_LINES + 1 }, (_, index) => Math.round((scale() / GRID_LINES) * index)));
	const read = (value: number) => (props.format ? props.format(value) : String(value));
	const point = (index: number | null) => {
		if (index == null) return null;
		const day = props.series.map((line) => ({ label: line.label, value: line.values[index] ?? 0, unit: line.unit ?? "" }));
		return { index, day };
	};
	const path = (values: number[]) => values.map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ");

	return (
		<div class="dashboard-chart">
			<svg
				viewBox={`0 0 ${width} ${height()}`}
				role="img"
				aria-label={`${props.series.map((line) => line.label).join(" and ")} per day: ${props.labels
					.map((label, index) => `${label} ${props.series.map((line) => read(line.values[index] ?? 0)).join("/")}`)
					.join(", ")}`}
				onPointerMove={(event) => {
					const box = event.currentTarget.getBoundingClientRect();
					const at = ((event.clientX - box.left) / box.width) * width;
					const index = Math.round(((at - PAD.l) / (width - PAD.l - PAD.r)) * Math.max(1, props.labels.length - 1));
					setHover(Math.min(props.labels.length - 1, Math.max(0, index)));
				}}
				onPointerLeave={() => setHover(null)}
			>
				<For each={ticks()}>
					{(tick) => (
						<>
							<line x1={PAD.l} x2={width - PAD.r} y1={yAt(tick)} y2={yAt(tick)} class="dashboard-chart-grid" />
							<text x={PAD.l - 6} y={yAt(tick) + 3} text-anchor="end" class="dashboard-chart-tick">
								{read(tick)}
							</text>
						</>
					)}
				</For>
				<For each={props.series}>{(line) => <path d={path(line.values)} class={line.muted ? "dashboard-chart-line muted" : "dashboard-chart-line"} />}</For>
				<Show when={props.series[0]}>{(line) => <circle cx={xAt(line().values.length - 1)} cy={yAt(line().values.at(-1) ?? 0)} r={3} class="dashboard-chart-end" />}</Show>
				<Show when={point(hover())}>
					{(spot) => (
						<>
							<line x1={xAt(spot().index)} x2={xAt(spot().index)} y1={PAD.t} y2={height() - PAD.b} class="dashboard-chart-cross" />
							<circle cx={xAt(spot().index)} cy={yAt(props.series[0]!.values[spot().index] ?? 0)} r={3.5} class="dashboard-chart-dot" />
						</>
					)}
				</Show>
			</svg>
			<Show when={point(hover())}>
				{(spot) => (
					<div class="dashboard-chart-tip" style={{ left: `${((xAt(spot().index) - 8) / width) * 100}%` }}>
						<div class="dashboard-chart-tip-day">{props.labels[spot().index]}</div>
						<For each={spot().day}>
							{(row) => (
								<div class="dashboard-chart-tip-row">
									<span class="dashboard-chart-tip-label">{row.label}</span>
									<span class="dashboard-chart-tip-value">
										{read(row.value)}
										{row.unit}
									</span>
								</div>
							)}
						</For>
					</div>
				)}
			</Show>
		</div>
	);
}
