import { EVENT_META } from "./meta.ts";
import type { TrajectoryRecord, TurnSummary } from "./model.ts";

export interface ScanResult {
	readonly data: TrajectoryRecord[];
	readonly turns: TurnSummary[];
}

export function scan(records: readonly TrajectoryRecord[]): ScanResult {
	const turns: TurnSummary[] = [];
	for (const record of records) {
		if (record.kind === "assistant") turns.push({ run: record.run, turn: record.turn });
	}

	const data: TrajectoryRecord[] = [];
	const seen = new Set<string>();
	for (const record of records) {
		const meta = EVENT_META[record.metaKey];
		if (meta?.hidden) continue;
		if (meta?.dedupe) {
			if (seen.has(record.metaKey)) continue;
			seen.add(record.metaKey);
		}
		data.push(record);
	}

	const pinned = data.filter((record, index) => EVENT_META[record.metaKey]?.pin !== undefined && data.findIndex((other) => other.metaKey === record.metaKey) === index);
	for (const record of pinned) {
		const anchor = EVENT_META[record.metaKey]?.pin;
		if (anchor === undefined) continue;
		const target = data.find((other) => other.metaKey === anchor);
		if (target === undefined) continue;
		if (data.indexOf(target) === data.indexOf(record) - 1) continue;
		data.splice(data.indexOf(record), 1);
		data.splice(data.indexOf(target) + 1, 0, record);
	}

	for (const record of data) {
		if (record.metaKey === "role:user") record.marks = 1;
	}
	return { data, turns };
}
