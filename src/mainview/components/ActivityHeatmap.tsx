import type { PartnerActivityDay } from "../../shared/rpc";
import { formatTokens } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const CELL = 10;
const GAP = 2;
const WEEKDAY_W = 22;
export const HEATMAP_WEEKS = 53;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TOKENS_PER_TURN = 3_000;
const LOAD_LEVELS = [100, 300, 900];

function loadOf(day: PartnerActivityDay): number {
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

function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function tipFor(day: PartnerActivityDay): string {
	const d = new Date(day.ts);
	const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
	return `${date} · ${formatTokens(day.freshTokens)} tok · ${count(day.turns, "turn", "turns")} · ${count(day.tools, "tool", "tools")}`;
}

interface MonthMark {
	col: number;
	label: string;
	span: number;
}

export function ActivityHeatmap(props: { days: PartnerActivityDay[]; weeks?: number; legend?: boolean }) {
	const weeks = props.weeks ?? 53;
	const shown = props.days.slice(-weeks * 7);

	const columns = (() => {
		const out: PartnerActivityDay[][] = [];
		for (let i = 0; i < shown.length; i += 7) out.push(shown.slice(i, i + 7));
		return out;
	})();

	const months = (() => {
		const out: MonthMark[] = [];
		for (const [i, col] of columns.entries()) {
			if (col.length === 0) continue;
			const rep = new Date(col[Math.min(3, col.length - 1)]!.ts);
			const label = MONTHS[rep.getMonth()]!;
			if (out.length > 0 && out[out.length - 1]!.label === label) out[out.length - 1]!.span += 1;
			else out.push({ col: i, label, span: 1 });
		}
		return out.filter((mark) => mark.span >= 3);
	})();

	return (
		<div className="activity-heatmap" style={{ "--activity-cell": `${CELL}px` } as React.CSSProperties}>
			<div
				className="activity-months"
				style={{
					marginLeft: `${WEEKDAY_W}px`,
					display: "grid",
					gridTemplateColumns: `repeat(${columns.length}, minmax(0, ${CELL}px))`,
					gap: `${GAP}px`,
				}}
			>
				{months.map((mark) => (
					<span key={`${mark.label}:${mark.col}`} style={{ gridColumn: `${mark.col + 1} / span ${mark.span}` }}>
						{mark.label}
					</span>
				))}
			</div>
			<div className="activity-grid" style={{ gap: `${GAP}px` }}>
				<div className="activity-weekdays" style={{ display: "grid", width: `${WEEKDAY_W}px`, gridTemplateRows: "repeat(7, 1fr)", gap: `${GAP}px` }}>
					<span style={{ gridRow: "1" }}>Mon</span>
					<span style={{ gridRow: "3" }}>Wed</span>
					<span style={{ gridRow: "5" }}>Fri</span>
				</div>
				<div
					className="activity-cells"
					style={{
						display: "grid",
						gridAutoFlow: "column",
						gridTemplateRows: "repeat(7, auto)",
						gridAutoColumns: `minmax(0, ${CELL}px)`,
						gap: `${GAP}px`,
					}}
				>
					{shown.map((day) => (
						<Tooltip key={day.ts} delayDuration={120}>
							<TooltipTrigger asChild>
								<div tabIndex={-1} className={`activity-cell hlv-${levelOf(loadOf(day))}`} />
							</TooltipTrigger>
							<TooltipContent side="top">{tipFor(day)}</TooltipContent>
						</Tooltip>
					))}
				</div>
			</div>
			{props.legend !== false && (
				<div className="activity-legend">
					<span className="activity-legend-label">less</span>
					<i className="activity-cell hlv-0" />
					<i className="activity-cell hlv-1" />
					<i className="activity-cell hlv-2" />
					<i className="activity-cell hlv-3" />
					<i className="activity-cell hlv-4" />
					<span className="activity-legend-label">more</span>
					<span className="activity-legend-note">shade blends turns and fresh tokens</span>
				</div>
			)}
		</div>
	);
}
