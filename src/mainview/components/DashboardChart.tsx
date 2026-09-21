import { useState } from "react";

export interface DashboardSeries {
	label: string;
	values: number[];
	unit?: string;
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
	const [hover, setHover] = useState<number | null>(null);
	const width = 320;
	const height = props.height ?? 150;
	const scale = nice(Math.max(...props.series.flatMap((line) => line.values), 1));
	const xAt = (index: number) => PAD.l + (index / Math.max(1, props.labels.length - 1)) * (width - PAD.l - PAD.r);
	const yAt = (value: number) => height - PAD.b - (value / scale) * (height - PAD.t - PAD.b);
	const ticks = Array.from({ length: GRID_LINES + 1 }, (_, index) => Math.round((scale / GRID_LINES) * index));
	const read = (value: number) => (props.format ? props.format(value) : String(value));
	const point = hover == null ? null : { index: hover, day: props.series.map((line) => ({ label: line.label, value: line.values[hover] ?? 0, unit: line.unit ?? "" })) };
	const path = (values: number[]) => values.map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ");

	return (
		<div className="dashboard-chart">
			<svg
				viewBox={`0 0 ${width} ${height}`}
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
				{ticks.map((tick) => (
					<g key={tick}>
						<line x1={PAD.l} x2={width - PAD.r} y1={yAt(tick)} y2={yAt(tick)} className="dashboard-chart-grid" />
						<text x={PAD.l - 6} y={yAt(tick) + 3} textAnchor="end" className="dashboard-chart-tick">
							{read(tick)}
						</text>
					</g>
				))}
				{props.series.map((line) => (
					<path key={line.label} d={path(line.values)} className={line.muted ? "dashboard-chart-line muted" : "dashboard-chart-line"} />
				))}
				{props.series[0] && <circle cx={xAt(props.series[0].values.length - 1)} cy={yAt(props.series[0].values.at(-1) ?? 0)} r={3} className="dashboard-chart-end" />}
				{point && (
					<>
						<line x1={xAt(point.index)} x2={xAt(point.index)} y1={PAD.t} y2={height - PAD.b} className="dashboard-chart-cross" />
						<circle cx={xAt(point.index)} cy={yAt(props.series[0]!.values[point.index] ?? 0)} r={3.5} className="dashboard-chart-dot" />
					</>
				)}
			</svg>
			{point && (
				<div className="dashboard-chart-tip" style={{ left: `${((xAt(point.index) - 8) / width) * 100}%` }}>
					<div className="dashboard-chart-tip-day">{props.labels[point.index]}</div>
					{point.day.map((row) => (
						<div className="dashboard-chart-tip-row" key={row.label}>
							<span className="dashboard-chart-tip-label">{row.label}</span>
							<span className="dashboard-chart-tip-value">
								{read(row.value)}
								{row.unit}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
