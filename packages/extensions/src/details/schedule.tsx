import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { RunRecord, ScheduleDefinition } from "../schedule/store.ts";
import { LoadingLines, Skeleton } from "./skeleton.tsx";
import { clockOf, clockTime } from "./utils.ts";

const EYEBROW = "ext-details-caption";
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
		const className = "sch-slot" + (node.next ? " is-next" : "") + (node.kind === "span" ? " is-span" : "") + (missed ? " is-miss" : "");

		return (
			<div className={className} key={node.key}>
				<span className="sch-at">{node.paused ? "—" : node.kind === "span" ? clockOf(new Date(node.spanFrom ?? node.at)) : clockOf(new Date(node.at))}</span>
				<span className="sch-spine">
					<i />
				</span>
				<span className="sch-body">
					<button type="button" className="sch-row" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : node.key)}>
						<span className="sch-title">{item.title || item.display}</span>
						<span className="sch-facts">
							<span className={missed ? "sch-miss" : node.next ? "sch-next" : "sch-muted"}>{facts.join(" · ")}</span>
						</span>
					</button>
					{isOpen ? (
						<div className="sch-detail">
							<p className="sch-prompt">{item.payload.text}</p>
							<div className="sch-meta">
								<span>{item.display}</span>
								<span className="sch-muted">·</span>
								<span>{item.runCount} runs</span>
								{props.sandbox && props.sandbox !== "—" ? (
									<>
										<span className="sch-muted">·</span>
										<span className="sch-muted">{props.sandbox}</span>
									</>
								) : null}
							</div>
							{runs.filter((run) => run.scheduleId === item.id).length > 0 ? (
								<ul className="sch-runs">
									{runs
										.filter((run) => run.scheduleId === item.id)
										.sort((left, right) => (right.dispatchedAt ?? right.scheduledAt) - (left.dispatchedAt ?? left.scheduledAt))
										.slice(0, 5)
										.map((run) => (
											<li key={run.runId}>
												<span className="sch-time">{clockTime(run.dispatchedAt ?? run.scheduledAt)}</span>
												<span className={run.status === "missed" ? "sch-miss" : "sch-muted"}>{STATUS_TEXT[run.status]}</span>
												<span className="sch-muted">{run.trigger}</span>
												{run.error ? <span className="sch-fail">{run.error}</span> : null}
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
		<section className="ext-details-card">
			<button type="button" className="ext-details-head-row" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className={EYEBROW}>Scheduled</span>
				<span className="ext-details-summary">{summary}</span>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
			</button>

			{open ? (
				<div className="sch-wrap">
					{props.loading && !props.data ? <LoadingLines rows={3} /> : null}
					{!props.loading && schedules.length === 0 ? (
						<div className="sch-empty">
							<p>Nothing scheduled</p>
							<p className="sch-muted">Ask in the chat to put work on the clock.</p>
						</div>
					) : null}
					{schedules.length > 0 ? (
						<div className="sch-axis">
							{axis.groups.map((group) => (
								<div className="sch-group" key={group.key}>
									<div className="sch-day">
										<span>{group.label}</span>
										<span className="sch-muted">{group.collapsed ? `${group.count} entries` : ""}</span>
									</div>
									{group.nodes.map(renderNode)}
									{group.folded > 0 ? <div className="sch-folded">… {group.folded} earlier</div> : null}
								</div>
							))}
							<div className="sch-now">
								<span className="sch-at">{clockOf(new Date(now))}</span>
								<span className="sch-now-line" />
							</div>
						</div>
					) : null}
				</div>
			) : null}
		</section>
	);
}
