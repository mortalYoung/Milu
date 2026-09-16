import { For } from "solid-js";
import type { PartnerActivityDay } from "../../shared/rpc";
import { formatTokens } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from "./ui/tooltip";

const CELL = 10;
const GAP = 2;
const COL = 12;
const GUTTER = 26;
const INNER = 476;
export const HEATMAP_WEEKS = Math.floor((INNER - GUTTER) / COL);

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

export function ActivityHeatmap(props: { days: PartnerActivityDay[] }) {
	// The series is always Monday-aligned; the last column is partial up to today.
	// Both the grid and the month rule are laid out from that same column count.
	const columns = () => {
		const out: PartnerActivityDay[][] = [];
		for (let i = 0; i < props.days.length; i += 7) out.push(props.days.slice(i, i + 7));
		return out;
	};
	const months = () => {
		const out: MonthMark[] = [];
		for (const [i, col] of columns().entries()) {
			if (col.length === 0) continue;
			const rep = new Date(col[Math.min(3, col.length - 1)].ts);
			const label = MONTHS[rep.getMonth()];
			if (out.length > 0 && out[out.length - 1].label === label) out[out.length - 1].span += 1;
			else out.push({ col: i, label, span: 1 });
		}
		return out.filter((m) => m.span >= 3);
	};

	return (
		<div class="activity-heatmap">
			<div
				class="activity-months"
				style={{
					"margin-left": `${GUTTER}px`,
					display: "grid",
					"grid-template-columns": `repeat(${columns().length}, ${CELL}px)`,
					gap: `${GAP}px`,
				}}
			>
				<For each={months()}>{(m) => <span style={{ "grid-column": `${m.col + 1} / span ${m.span}` }}>{m.label}</span>}</For>
			</div>
			<div class="activity-grid" style={{ gap: `${GAP}px` }}>
				<div class="activity-weekdays" style={{ display: "grid", "grid-template-rows": `repeat(7, ${CELL}px)`, gap: `${GAP}px` }}>
					<span style={{ "grid-row": "1" }}>Mon</span>
					<span style={{ "grid-row": "3" }}>Wed</span>
					<span style={{ "grid-row": "5" }}>Fri</span>
				</div>
				<div
					class="activity-cells"
					style={{
						display: "grid",
						"grid-template-rows": `repeat(7, ${CELL}px)`,
						"grid-auto-flow": "column",
						"grid-auto-columns": `${CELL}px`,
						gap: `${GAP}px`,
					}}
				>
					<For each={props.days}>
						{(day) => (
							<Tooltip openDelay={120} closeDelay={60} placement="top">
								<TooltipTrigger as="div" tabIndex={-1} class={`activity-cell hlv-${levelOf(loadOf(day))}`} />
								<TooltipPortal>
									<TooltipContent>{tipFor(day)}</TooltipContent>
								</TooltipPortal>
							</Tooltip>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}
