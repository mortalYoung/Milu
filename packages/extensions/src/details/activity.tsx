import { Tip } from "../host/tooltip.tsx";
import type { ActivityDay } from "./details.ts";
import { formatTokens } from "./utils.ts";

const GAP = 2;
const TOKENS_PER_TURN = 3_000;
const LOAD_LEVELS = [100, 300, 900];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function loadOf(day: ActivityDay): number {
	return day.turns + day.freshTokens / TOKENS_PER_TURN;
}

function levelOf(load: number): number {
	if (load <= 0) return 0;
	let passed = 0;
	for (const bound of LOAD_LEVELS) {
		if (load < bound) break;
		passed += 1;
	}
	return passed + 1;
}

function count(value: number, one: string, many: string): string {
	return `${value} ${value === 1 ? one : many}`;
}

function tipFor(day: ActivityDay): string {
	const date = new Date(day.ts);
	return `${MONTHS[date.getMonth()]} ${date.getDate()} · ${formatTokens(day.freshTokens)} tok · ${count(day.turns, "turn", "turns")} · ${count(day.tools, "tool", "tools")}`;
}

function emptyDays(weeks: number): ActivityDay[] {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const start = new Date(today);
	start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7);
	const days: ActivityDay[] = [];
	for (const cursor = new Date(start); cursor.getTime() <= today.getTime(); cursor.setDate(cursor.getDate() + 1)) {
		days.push({ ts: cursor.getTime(), tokens: 0, freshTokens: 0, turns: 0, tools: 0 });
	}
	return days;
}

interface MonthMark {
	col: number;
	label: string;
	span: number;
}

export function ActivityHeatmap(props: { days: readonly ActivityDay[]; weeks?: number; legend?: boolean; loading?: boolean }) {
	const weeks = props.weeks ?? 53;
	const base = props.days.length > 0 ? props.days : props.loading ? emptyDays(weeks) : [];
	const shown = base.slice(-weeks * 7);
	const cellStyle = { ["--act-gap" as string]: `${GAP}px` };

	const columns: ActivityDay[][] = [];
	for (let index = 0; index < shown.length; index += 7) columns.push(shown.slice(index, index + 7));

	const months: MonthMark[] = [];
	for (const [index, column] of columns.entries()) {
		if (column.length === 0) continue;
		const representative = new Date(column[Math.min(3, column.length - 1)]!.ts);
		const label = MONTHS[representative.getMonth()]!;
		const last = months[months.length - 1];
		if (last && last.label === label) last.span += 1;
		else months.push({ col: index, label, span: 1 });
	}

	return (
		<div className="ext-act" style={cellStyle}>
			<div className="ext-act-months" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
				{months
					.filter((mark) => mark.span >= 3)
					.map((mark) => (
						<span key={`${mark.label}:${mark.col}`} style={{ gridColumn: `${mark.col + 1} / span ${mark.span}` }}>
							{mark.label}
						</span>
					))}
			</div>
			<div className="ext-act-grid">
				<div className="ext-act-weekdays">
					<span style={{ gridRow: "1" }}>Mon</span>
					<span style={{ gridRow: "3" }}>Wed</span>
					<span style={{ gridRow: "5" }}>Fri</span>
				</div>
				<div className="ext-act-cells">
					{shown.map((day) =>
						props.loading ? (
							<div key={day.ts} className="ext-act-cell hlv-0 is-loading" />
						) : (
							<Tip key={day.ts} label={tipFor(day)}>
								<div className={`ext-act-cell hlv-${levelOf(loadOf(day))}`} />
							</Tip>
						),
					)}
				</div>
			</div>
			{props.legend === false ? null : (
				<div className="ext-act-legend">
					<span>less</span>
					<i className="ext-act-cell hlv-0" />
					<i className="ext-act-cell hlv-1" />
					<i className="ext-act-cell hlv-2" />
					<i className="ext-act-cell hlv-3" />
					<i className="ext-act-cell hlv-4" />
					<span>more</span>
					<span className="ext-act-note">shade blends turns and fresh tokens</span>
				</div>
			)}
		</div>
	);
}
