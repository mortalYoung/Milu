import { React } from "./runtime.ts";

const WIDTH = 100;
const HEIGHT = 34;
const PAD = 2;

export function Sparkline(props: { values: readonly number[]; min?: number; max?: number }) {
	const values = props.values.length === 0 ? [0] : props.values;
	const min = props.min ?? Math.min(...values);
	const max = props.max ?? Math.max(...values);
	const span = Math.max(1, max - min);
	const points = values.map((value, index) => {
		const x = PAD + (index * (WIDTH - PAD * 2)) / Math.max(1, values.length - 1);
		const y = HEIGHT - PAD - ((Math.min(max, Math.max(min, value)) - min) / span) * (HEIGHT - PAD * 2);
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	});
	return (
		<svg className="telemetry-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
			<polyline points={points.join(" ")} />
		</svg>
	);
}
