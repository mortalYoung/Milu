/**
 * Entry → Data for the Trajectory views. One record per entry (≈1:1, entryId equal): the per-kind
 * shape comes from the event's `data` metadata, the run/turn cursor from its `cursor` metadata,
 * and the base stamps (seq/entryId/metaKey/time) are filled in here. Entries without a `data`
 * producer fall back to a raw custom record, except messages and unknown kinds, which drop.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import { type Cursor, EVENT_META, entryKey } from "./entry-meta";
import { eventNumber } from "./record";
import type { EntryPayload, TrajectoryRecord } from "./rpc";

export { contentText, toTrajectoryUsage, toUsage, type Usage } from "./record";

function upcomingRuns(entries: Entry[]): number[] {
	const upcoming = new Array<number>(entries.length).fill(0);
	let next = 0;
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === "agent/start") next = eventNumber(entry, "run", next);
		upcoming[i] = next;
	}
	return upcoming;
}

function defaultPayload(entry: Entry): EntryPayload | null {
	return entry.type === "custom" ? { kind: "custom", customType: entry.customType, data: entry.data } : null;
}

export function buildData(entries: Entry[]): TrajectoryRecord[] {
	const upcoming = upcomingRuns(entries);
	const cursor: Cursor = { run: 0, turn: 0, open: false };
	const out: TrajectoryRecord[] = [];
	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i];
		const meta = EVENT_META[entryKey(entry)];
		meta?.cursor?.(cursor, entry);
		const payload = meta?.data === undefined ? defaultPayload(entry) : meta.data(entry);
		if (payload === null) continue;
		const placement = cursor.open ? { run: cursor.run, turn: cursor.turn || 1 } : { run: upcoming[i] || cursor.run + 1, turn: 1 };
		out.push({ seq: out.length, entryId: entry.id, metaKey: entryKey(entry), time: entry.timestamp, ...placement, ...payload } as TrajectoryRecord);
		if (meta?.close) cursor.open = false;
	}
	return out;
}
