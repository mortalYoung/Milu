import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { RunRecord, ScheduleDefinition } from "../../schedule/store.ts";
import { CARD, EYEBROW, HEAD_ROW, SUMMARY } from "../chrome.ts";
import { clockOf, clockTime } from "../utils.ts";
import { LoadingLines, Skeleton } from "./skeleton.tsx";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MAX_NODES = 6;
const DAY_MS = 86_400_000;

interface AxisRun {
	readonly runId: string;
	readonly status: RunRecord["status"];
	readonly at: number;
	readonly error?: string;
}

interface AxisNode {
	readonly key: string;
	readonly item: ScheduleDefinition;
	readonly at: number;
	readonly kind: "fire" | "span";
	readonly spanFrom?: number;
	readonly runs: readonly AxisRun[];
	readonly next: boolean;
	readonly paused?: boolean;
}

interface AxisGroup {
	readonly key: string;
	readonly label: string;
	readonly nodes: readonly AxisNode[];
	readonly folded: number;
	readonly collapsed: boolean;
	readonly count: number;
}

interface ScheduleAxis {
	readonly groups: readonly AxisGroup[];
	readonly next: number | null;
	readonly active: number;
}

const STATUS_TEXT: Record<RunRecord["status"], string> = {
	dispatched: "sent",
	missed: "missed",
	skipped: "skipped",
};

const startOfDay = (at: number) => {
	const date = new Date(at);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

const dayKey = (at: number) => {
	const date = new Date(at);
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

function dayLabel(at: number, now: number): string {
	const date = new Date(at);
	const stamp = `${WEEKDAYS[date.getDay()]} · ${MONTHS[date.getMonth()]} ${date.getDate()}`;
	if (startOfDay(at) === startOfDay(now)) return `TODAY · ${stamp}`;
	if (startOfDay(at) === startOfDay(now) + DAY_MS) return `TOMORROW · ${stamp}`;
	return stamp;
}

function scheduleStatus(item: ScheduleDefinition): string {
	return item.enabled && item.lifecycleStatus === "active" ? "active" : item.lifecycleStatus;
}

function isLive(item: ScheduleDefinition): boolean {
	return item.enabled && item.lifecycleStatus === "active";
}

function buildScheduleAxis(items: readonly ScheduleDefinition[], history: readonly RunRecord[], now: number): ScheduleAxis {
	const today = startOfDay(now);
	const nodes: AxisNode[] = [];

	for (const item of items) {
		const todays = history
			.filter((record) => record.scheduleId === item.id && (record.dispatchedAt ?? record.scheduledAt) >= today)
			.sort((left, right) => (left.dispatchedAt ?? left.scheduledAt) - (right.dispatchedAt ?? right.scheduledAt));
		const runs: AxisRun[] = todays.map((record) => ({
			runId: record.runId,
			status: record.status,
			at: record.dispatchedAt ?? record.scheduledAt,
			...(record.error ? { error: record.error } : {}),
		}));

		if (runs.length > 0) {
			const first = runs[0]!;
			const last = runs[runs.length - 1]!;
			if (item.schedule.kind === "interval") {
				nodes.push({ key: `${item.id}:span`, item, at: last.at, kind: "span", spanFrom: first.at, runs, next: false });
			} else {
				for (const run of runs.slice(-3)) nodes.push({ key: `${item.id}:${run.runId}`, item, at: run.at, kind: "fire", runs: [run], next: false });
			}
		}

		if (isLive(item) && item.nextRunAt !== null) {
			nodes.push({ key: `${item.id}:next`, item, at: item.nextRunAt, kind: "fire", runs: [], next: true });
		}
	}

	for (const item of items.filter((entry) => !isLive(entry) || entry.nextRunAt === null)) {
		nodes.push({ key: `${item.id}:idle`, item, at: Number.MAX_SAFE_INTEGER, kind: "fire", runs: [], next: false, paused: true });
	}

	nodes.sort((left, right) => left.at - right.at);

	const grouped = new Map<string, AxisNode[]>();
	for (const node of nodes) {
		if (node.key.endsWith(":idle")) continue;
		const key = dayKey(node.at);
		const list = grouped.get(key);
		if (list) list.push(node);
		else grouped.set(key, [node]);
	}
	if (!grouped.has(dayKey(now))) grouped.set(dayKey(now), []);

	const order = [...grouped.keys()].sort((left, right) => Number(left.split("-")[1]) - Number(right.split("-")[1]) || Number(left.split("-")[2]) - Number(right.split("-")[2]));
	const groups: AxisGroup[] = order.map((key) => {
		const list = grouped.get(key) ?? [];
		const at = list[0]?.at ?? now;
		const far = key !== dayKey(now) && key !== dayKey(now + DAY_MS);
		let nodes = list;
		let folded = 0;
		if (list.length > MAX_NODES) {
			const nowIndex = list.findIndex((node) => node.at > now);
			const keepFrom = nowIndex < 0 ? list.length - MAX_NODES : Math.max(0, nowIndex - 2);
			const keep = list.slice(keepFrom, keepFrom + MAX_NODES);
			folded = list.length - keep.length;
			nodes = keep;
		}
		return { key, label: dayLabel(at, now), nodes: far ? [] : nodes, folded, collapsed: far, count: list.length };
	});

	const idle = nodes.filter((node) => node.key.endsWith(":idle"));
	if (idle.length > 0) groups.push({ key: "idle", label: "NOT RUNNING", nodes: idle, folded: 0, collapsed: false, count: idle.length });

	const upcoming = items.map((item) => item.nextRunAt).filter((value): value is number => value !== null);
	return { groups, next: upcoming.length > 0 ? Math.min(...upcoming) : null, active: items.filter((item) => isLive(item)).length };
}

export function ScheduleSection(props: {
	data: { readonly schedules: readonly ScheduleDefinition[]; readonly runs: readonly RunRecord[] } | null;
	sandbox?: string;
	loading?: boolean;
}) {
	const [open, setOpen] = useState(true);
	const [expanded, setExpanded] = useState<string | null>(null);
	const [now] = useState(() => Date.now());
	const schedules = props.data?.schedules ?? [];
	const runs = props.data?.runs ?? [];
	const axis = buildScheduleAxis(schedules, runs, now);
	const latest = [...runs].sort((left, right) => (right.dispatchedAt ?? right.scheduledAt) - (left.dispatchedAt ?? left.scheduledAt))[0];
	const summary =
		schedules.length === 0 ? (
			props.loading ? (
				<Skeleton width={150} height={10} />
			) : (
				"—"
			)
		) : (
			[`${axis.active} active`, axis.next === null ? "nothing scheduled" : `next ${clockTime(axis.next)}`, latest ? `last ${STATUS_TEXT[latest.status]}` : null]
				.filter(Boolean)
				.join(" · ")
		);

	function renderNode(node: AxisNode) {
		const item = node.item;
		const isOpen = expanded === node.key;
		const facts: string[] = [];
		if (node.paused) facts.push(item.lifecycleStatus === "finished" ? "finished" : "paused", item.display);
		else if (node.kind === "span") facts.push(`every ${item.display.replace(/^every /, "")}`, `${node.runs.length} runs today`);
		else if (node.next) facts.push(`next · ${clockOf(new Date(node.at))}`, isLive(item) ? `every ${item.display.replace(/^daily |^every |^once · /, "")}` : scheduleStatus(item));
		else {
			const run = node.runs[0];
			if (run) {
				facts.push(STATUS_TEXT[run.status]);
				if (run.error) facts.push(run.error);
			}
		}
		const missed = node.runs.some((run) => run.status === "missed");
		const span = node.kind === "span";

		return (
			<div className="grid grid-cols-[44px_10px_minmax(0,1fr)] items-start" key={node.key}>
				<span className="pt-[7px] pr-1.5 text-right font-mono text-[11px] tabular-nums text-ink-soft">
					{node.paused ? "—" : span ? clockOf(new Date(node.spanFrom ?? node.at)) : clockOf(new Date(node.at))}
				</span>
				<span className="relative self-stretch">
					{span ? <span className="absolute inset-y-0 left-[3px] w-[3px] rounded-full bg-line-strong" /> : <span className="absolute inset-y-0 left-1 w-px bg-line" />}
					{span ? null : (
						<span
							className={`absolute top-2.5 left-[0.5px] block size-2 rounded-full border-[1.5px] bg-surface ${missed ? "border-accent-amber bg-accent-amber" : node.next ? "border-ink bg-ink" : "border-muted-soft"}`}
						/>
					)}
				</span>
				<span className="relative flex min-w-0 flex-col pb-2 pl-2">
					<button
						type="button"
						className="flex min-w-0 cursor-pointer flex-col gap-[3px] bg-transparent p-0 text-left"
						aria-expanded={isOpen}
						onClick={() => setExpanded(isOpen ? null : node.key)}
					>
						<span className="overflow-hidden font-sans text-[12px] text-ellipsis whitespace-nowrap text-ink">{item.title || item.display}</span>
						<span className="overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap text-muted">
							<span className={missed ? "text-accent-amber" : node.next ? "text-ink" : "text-muted"}>{facts.join(" · ")}</span>
						</span>
					</button>
					{isOpen ? (
						<div className="mt-2 flex flex-col gap-1.5 rounded-md border-[0.5px] border-line bg-canvas p-2">
							<p className="m-0 text-[12px] leading-[1.6] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{item.payload.text}</p>
							<div className="flex items-baseline gap-1.5 font-mono text-[11px] text-muted">
								<span>{item.display}</span>
								<span className="text-muted">·</span>
								<span>{item.runCount} runs</span>
								{props.sandbox && props.sandbox !== "—" ? (
									<>
										<span className="text-muted">·</span>
										<span className="text-muted">{props.sandbox}</span>
									</>
								) : null}
							</div>
							{runs.filter((run) => run.scheduleId === item.id).length > 0 ? (
								<ul className="m-0 flex list-none flex-col gap-0.5 border-t-[0.5px] border-line px-0 pt-1.5">
									{runs
										.filter((run) => run.scheduleId === item.id)
										.sort((left, right) => (right.dispatchedAt ?? right.scheduledAt) - (left.dispatchedAt ?? left.scheduledAt))
										.slice(0, 5)
										.map((run) => (
											<li className="flex items-baseline gap-2 font-mono text-[11px] text-muted" key={run.runId}>
												<span className="text-muted">{clockTime(run.dispatchedAt ?? run.scheduledAt)}</span>
												<span className={run.status === "missed" ? "text-accent-amber" : "text-muted"}>{STATUS_TEXT[run.status]}</span>
												<span className="text-muted">{run.trigger}</span>
												{run.error ? <span className="text-signal">{run.error}</span> : null}
											</li>
										))}
								</ul>
							) : null}
						</div>
					) : null}
				</span>
			</div>
		);
	}

	return (
		<section className={CARD}>
			<button type="button" className={HEAD_ROW} aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className={EYEBROW}>Scheduled</span>
				<span className={SUMMARY}>{summary}</span>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
			</button>

			{open ? (
				<div className="flex flex-col gap-2 border-t-[0.5px] border-line px-3 pt-2.5 pb-3">
					{props.loading && !props.data ? <LoadingLines rows={3} /> : null}
					{!props.loading && schedules.length === 0 ? (
						<div className="flex flex-col gap-1">
							<p className="m-0 text-[12px] text-ink">Nothing scheduled</p>
							<p className="m-0 text-[12px] text-muted">Ask in the chat to put work on the clock.</p>
						</div>
					) : null}
					{schedules.length > 0 ? (
						<div className="flex flex-col gap-2">
							{axis.groups.map((group) => (
								<div className="flex flex-col" key={group.key}>
									<div className="flex items-baseline justify-between gap-2 pb-1 font-mono text-[10px] tracking-[0.1em] text-muted">
										<span>{group.label}</span>
										<span className="text-muted">{group.collapsed ? `${group.count} entries` : ""}</span>
									</div>
									{group.nodes.map(renderNode)}
									{group.folded > 0 ? <div className="pb-1 pl-[54px] font-mono text-[10px] text-muted-soft">… {group.folded} earlier</div> : null}
								</div>
							))}
							<div className="grid grid-cols-[44px_minmax(0,1fr)] items-center">
								<span className="pr-1.5 text-right font-mono text-[11px] font-semibold tabular-nums text-ink">{clockOf(new Date(now))}</span>
								<span className="h-px bg-[color-mix(in_srgb,var(--ink)_35%,transparent)]" />
							</div>
						</div>
					) : null}
				</div>
			) : null}
		</section>
	);
}
