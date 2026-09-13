/**
 * The scan: one pass that turns folded records into the rows the trajectory view shows, plus the
 * per-turn summaries for the density band. Curation rules live on the event metadata — `hidden`
 * drops the record, `dedupe` keeps the first of its kind, `pin` moves the first of its kind right
 * after another key — so the scan applies them without knowing any event by name.
 */
import { EVENT_META } from "./entry-meta";
import type { TrajectoryRecord } from "./rpc";

/** One turn's summary for the density band. */
export interface TurnSummary {
	run: number;
	turn: number;
	density: "l1" | "l2" | "l3";
}

export interface ScanResult {
	data: TrajectoryRecord[];
	turns: TurnSummary[];
}

export function scan(records: TrajectoryRecord[]): ScanResult {
	const turns: TurnSummary[] = [];
	for (const record of records) {
		if (record.kind === "assistant") turns.push({ run: record.run, turn: record.turn, density: tokensToDensity(record.usage?.totalTokens ?? 0) });
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
	for (const record of [...data]) {
		const anchor = EVENT_META[record.metaKey]?.pin;
		if (anchor === undefined) continue;
		if (data.find((other) => other.metaKey === record.metaKey) !== record) continue;
		const target = data.find((other) => other.metaKey === anchor);
		if (target === undefined) continue;
		const from = data.indexOf(record);
		const to = data.indexOf(target);
		if (from === to + 1) continue;
		data.splice(from, 1);
		data.splice(to + 1, 0, record);
	}
	for (const record of data) {
		if (record.kind === "user" && record.metaKey === "role:user") record.marks = 1;
	}
	return { data, turns };
}

/** Bucket by token workload: <1k light, <4k medium, else heavy (visual budget goes to what varies). */
function tokensToDensity(tokens: number): "l1" | "l2" | "l3" {
	if (tokens < 1000) return "l1";
	if (tokens < 4000) return "l2";
	return "l3";
}
