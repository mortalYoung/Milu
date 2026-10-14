import type { ScheduleItem, ScheduleRunItem } from "../../shared/rpc";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MAX_NODES = 6;

export interface AxisRun {
	runId: string;
	status: ScheduleRunItem["status"];
	at: number;
	error?: string;
}

export interface AxisNode {
	key: string;
	item: ScheduleItem;
	at: number;
	kind: "fire" | "span";
	spanFrom?: number;
	runs: AxisRun[];
	next: boolean;
	retrying: boolean;
	ended: boolean;
	paused?: boolean;
}

export interface AxisGroup {
	key: string;
	label: string;
	nodes: AxisNode[];
	folded: number;
	collapsed: boolean;
	count: number;
}

export interface ScheduleAxis {
	groups: AxisGroup[];
	next: number | null;
	active: number;
}

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
	if (startOfDay(at) === startOfDay(now) + 86_400_000) return `TOMORROW · ${stamp}`;
	return stamp;
}

const isRun = (record: ScheduleRunItem) => record.status === "done" || record.status === "failed" || record.status === "missed" || record.status === "skipped";

/** Time is the skeleton: today's runs and the next fire of every definition land on one axis. */
export function buildScheduleAxis(items: ScheduleItem[], history: ScheduleRunItem[], now: number): ScheduleAxis {
	const today = startOfDay(now);
	const nodes: AxisNode[] = [];

	for (const item of items) {
		const todays = history
			.filter((record) => record.scheduleId === item.id && isRun(record) && (record.dispatchedAt ?? record.scheduledAt) >= today)
			.sort((a, b) => (a.dispatchedAt ?? a.scheduledAt) - (b.dispatchedAt ?? b.scheduledAt));
		const runs: AxisRun[] = todays.map((record) => ({
			runId: record.runId,
			status: record.status,
			at: record.dispatchedAt ?? record.scheduledAt,
			...(record.error ? { error: record.error } : {}),
		}));

		if (todays.length > 0) {
			const first = todays[0]!;
			const last = todays[todays.length - 1]!;
			const from = first.dispatchedAt ?? first.scheduledAt;
			const to = last.dispatchedAt ?? last.scheduledAt;
			if (item.kind === "interval") {
				nodes.push({ key: `${item.id}:span`, item, at: to, kind: "span", spanFrom: from, runs, next: false, retrying: false, ended: true });
			} else {
				for (const run of runs.slice(-3)) {
					nodes.push({ key: `${item.id}:${run.runId}`, item, at: run.at, kind: "fire", runs: [run], next: false, retrying: false, ended: true });
				}
			}
		}

		const upcoming = item.retryAt ?? item.nextRunAt;
		const live = item.status === "active" && upcoming != null;
		if (live && upcoming != null) {
			nodes.push({ key: `${item.id}:next`, item, at: upcoming, kind: "fire", runs: [], next: true, retrying: item.retryAt != null, ended: false });
		}
	}

	for (const item of items.filter((entry) => entry.status !== "active" || (entry.retryAt ?? entry.nextRunAt) == null)) {
		nodes.push({ key: `${item.id}:idle`, item, at: Number.MAX_SAFE_INTEGER, kind: "fire", runs: [], next: false, retrying: false, ended: false, paused: true });
	}

	nodes.sort((a, b) => a.at - b.at);

	const grouped = new Map<string, AxisNode[]>();
	for (const node of nodes) {
		if (node.key.endsWith(":idle")) continue;
		const key = dayKey(node.at);
		const list = grouped.get(key);
		if (list) list.push(node);
		else grouped.set(key, [node]);
	}
	if (!grouped.has(dayKey(now))) grouped.set(dayKey(now), []);

	const order = [...grouped.keys()].sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]) || Number(a.split("-")[2]) - Number(b.split("-")[2]));
	const groups: AxisGroup[] = order.map((key) => {
		const list = grouped.get(key) ?? [];
		const at = list[0]?.at ?? now;
		const far = key !== dayKey(now) && key !== dayKey(now + 86_400_000);
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

	const upcoming = items.map((item) => item.retryAt ?? item.nextRunAt).filter((value): value is number => value != null);
	return { groups, next: upcoming.length > 0 ? Math.min(...upcoming) : null, active: items.filter((item) => item.status === "active").length };
}

export function clockTime(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
