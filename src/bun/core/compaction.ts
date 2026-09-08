import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENTS } from "../persist/events";
import type { MemoryRecord } from "./memory";
import { formatMemoryRecord } from "./memory";

const KEEP_ENTRIES = 16;

const MEMORY_CHECKPOINT_PREAMBLE = "Earlier messages have been archived to this partner's long-term memory.";
const MEMORY_CHECKPOINT_EVENTS_HEADER = "Recent events before this checkpoint:";
const MEMORY_CHECKPOINT_FOOTER = "If you need details from before this checkpoint, call read_memory.";

export interface CompactionPlan {
	throughEntryId: string;
	checkpointText: string;
	shadowed: number;
}

export interface MemoryCompactionOptions {
	eventDigestCount?: number;
	memoryEvents?: MemoryRecord[];
}

function memoryCheckpointText(entries: Entry[], throughIndex: number, memoryEvents: MemoryRecord[], eventDigestCount: number): string {
	const indexById = new Map(entries.map((e, i) => [e.id, i]));
	const relevant = memoryEvents
		.filter((m) => m.kind === "event" && m.source.rawIds.some((id) => indexById.get(id) != null && indexById.get(id)! <= throughIndex))
		.map((m) => {
			let first = Number.POSITIVE_INFINITY;
			for (const id of m.source.rawIds) {
				const idx = indexById.get(id);
				if (idx != null && idx < first) first = idx;
			}
			return { record: m, first };
		})
		.filter((m) => Number.isFinite(m.first))
		.sort((a, b) => a.first - b.first);
	const selected = eventDigestCount > 0 ? relevant.slice(-eventDigestCount).sort((a, b) => a.first - b.first) : [];
	const parts = [MEMORY_CHECKPOINT_PREAMBLE];
	if (selected.length > 0) {
		parts.push(MEMORY_CHECKPOINT_EVENTS_HEADER);
		selected.forEach(({ record }, i) => {
			if (i > 0) parts.push("");
			parts.push(formatMemoryRecord(record, { withDetail: false }));
		});
	}
	parts.push(MEMORY_CHECKPOINT_FOOTER);
	return parts.join("\n");
}

export async function planMemoryCompaction(entries: Entry[], opts: MemoryCompactionOptions = {}): Promise<CompactionPlan | null> {
	const throughIndex = entries.length - KEEP_ENTRIES - 1;
	if (throughIndex < 0) return null;
	const throughEntry = entries[throughIndex];
	if (!throughEntry) return null;
	return {
		throughEntryId: throughEntry.id,
		checkpointText: memoryCheckpointText(entries, throughIndex, opts.memoryEvents ?? [], opts.eventDigestCount ?? 5),
		shadowed: throughIndex + 1,
	};
}

export function hasOrphanCompactionStart(entries: Entry[]): boolean {
	let open = 0;
	for (const e of entries) {
		if (e.type !== "custom") continue;
		if (e.customType === EVENTS.compactionStart) open += 1;
		else if (e.customType === EVENTS.compactionEnd) open = Math.max(0, open - 1);
	}
	return open > 0;
}

export async function applyCompaction(
	session: {
		scope(dir: string): {
			appendCompactionRecord(type: "compaction/start" | "compaction/end", details: Record<string, unknown>, timestamp: number): Promise<void>;
			appendCompaction(details: { summary: string; throughEntryId: string }, timestamp: number): Promise<string>;
		};
	},
	dir: string,
	plan: CompactionPlan,
): Promise<void> {
	const ts = Date.now();
	const scope = session.scope(dir);
	await scope.appendCompactionRecord("compaction/start", {}, ts);
	await scope.appendCompaction({ summary: plan.checkpointText, throughEntryId: plan.throughEntryId }, ts);
	await scope.appendCompactionRecord("compaction/end", { ok: true, shadowed: plan.shadowed }, ts);
}
