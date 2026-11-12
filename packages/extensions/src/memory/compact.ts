import { EVENTS, type CompactionPlan, type Entry } from "@milu/core";

import { extractionEntries, formatMemoryRecord, type MemoryKind, type MemoryRecord } from "./store.ts";

const MIN_ENTRIES = 8;
export const DEFAULT_DIGEST_MAX_ITEMS = 10;
const EVENT_RESERVED = 3;
const QA_PAIRS = 5;
const QA_MAX_CHARS = 200;

const MEMORY_CHECKPOINT_PREAMBLE = "Earlier messages have been archived to this partner's long-term memory.";
const MEMORY_CHECKPOINT_DIGEST_HEADER = "Recent memories before this checkpoint:";
const MEMORY_CHECKPOINT_FOOTER = 'If you need details from before this checkpoint, call memory with op "read".';
const REMOVED_CHECKPOINT_PREAMBLE = "Earlier messages were removed from the active context to keep the conversation within the model's window; they remain in the session log.";
const QA_HEADER = "Recent Q/A:";

const DIGEST_KIND_ORDER: readonly MemoryKind[] = ["update", "preference", "instruction", "attribute", "reference"];

export interface MemoryCompactionOptions {
	readonly digestMaxItems?: number;
	readonly memoryEvents?: readonly MemoryRecord[];
	readonly covered?: boolean;
	readonly coveredIndex?: number;
	readonly memoryAvailable?: boolean;
}

function isUserMessage(entry: Entry): boolean {
	return entry.type === "message" && entry.message.role === "user";
}

function shadowEnd(entries: readonly Entry[], covered: number): number {
	for (let index = covered + 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry && isUserMessage(entry)) return index - 1;
	}
	return -1;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const text = block as { type?: unknown; text?: unknown };
		if (text && text.type === "text" && typeof text.text === "string") parts.push(text.text);
	}
	return parts.join(" ");
}

function oneLine(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > QA_MAX_CHARS ? `${line.slice(0, QA_MAX_CHARS)}…` : line;
}

function recentQa(entries: readonly Entry[], limit: number): string {
	const pairs: { q: string; a: string }[] = [];
	let current: { q: string; a: string } | null = null;
	for (const entry of extractionEntries(entries)) {
		if (entry.type !== "message") continue;
		if (entry.message.role === "user") {
			if (current) pairs.push(current);
			current = { q: oneLine(messageText(entry.message.content)), a: "" };
		} else if (current && entry.message.role === "assistant") {
			const text = oneLine(messageText(entry.message.content));
			if (text) current.a = text;
		}
	}
	if (current) pairs.push(current);
	return pairs
		.slice(-limit)
		.map(({ q, a }) => (a ? `- Q: ${q}\n  A: ${a}` : `- Q: ${q}`))
		.join("\n");
}

function previousCompactionEnd(entries: readonly Entry[], endIndex: number): number {
	for (let index = endIndex; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== EVENTS.compaction) continue;
		const through = (entry.data as { throughEntryId?: unknown } | undefined)?.throughEntryId;
		if (typeof through !== "string") return -1;
		return entries.findIndex((candidate) => candidate.id === through);
	}
	return -1;
}

function firstIndex(record: MemoryRecord, indexById: Map<string, number>): number {
	let best = Number.POSITIVE_INFINITY;
	for (const id of record.source.rawIds) {
		const at = indexById.get(id);
		if (at != null && at < best) best = at;
	}
	return best;
}

function kindRank(kind: MemoryKind): number {
	const rank = DIGEST_KIND_ORDER.indexOf(kind);
	return rank < 0 ? DIGEST_KIND_ORDER.length : rank;
}

function selectDigest(records: readonly MemoryRecord[], indexById: Map<string, number>, spanStart: number, endIndex: number, max: number): MemoryRecord[] {
	const inSpan = records.map((record) => ({ record, at: firstIndex(record, indexById) })).filter((item) => item.at >= spanStart && item.at <= endIndex);
	if (inSpan.length === 0) return [];
	const events = inSpan.filter((item) => item.record.kind === "event").sort((left, right) => left.at - right.at);
	const keepEvents = events.slice(-EVENT_RESERVED);
	const durable = inSpan
		.filter((item) => item.record.kind !== "event")
		.sort((left, right) => kindRank(left.record.kind) - kindRank(right.record.kind) || right.at - left.at)
		.slice(0, Math.max(0, max - keepEvents.length));
	return [...keepEvents, ...durable].sort((left, right) => left.at - right.at).map((item) => item.record);
}

function memoryCheckpointText(entries: readonly Entry[], endIndex: number, opts: MemoryCompactionOptions): string {
	const indexById = new Map(entries.map((entry, index) => [entry.id, index]));
	const spanStart = previousCompactionEnd(entries, endIndex) + 1;
	const selected = selectDigest(opts.memoryEvents ?? [], indexById, spanStart, endIndex, opts.digestMaxItems ?? DEFAULT_DIGEST_MAX_ITEMS);
	const parts = [MEMORY_CHECKPOINT_PREAMBLE];
	if (selected.length > 0) {
		parts.push(MEMORY_CHECKPOINT_DIGEST_HEADER);
		parts.push(selected.map((record) => formatMemoryRecord(record, { withDetail: false })).join("\n\n"));
	}
	parts.push(MEMORY_CHECKPOINT_FOOTER);
	return parts.join("\n");
}

function qaCheckpointText(entries: readonly Entry[], endIndex: number, opts: MemoryCompactionOptions): string {
	const parts = [REMOVED_CHECKPOINT_PREAMBLE];
	const qa = recentQa(entries.slice(0, endIndex + 1), QA_PAIRS);
	if (qa) parts.push(QA_HEADER, qa);
	if (opts.memoryAvailable) parts.push(MEMORY_CHECKPOINT_FOOTER);
	return parts.join("\n");
}

export function planMemoryCompaction(entries: readonly Entry[], opts: MemoryCompactionOptions = {}): CompactionPlan | null {
	if (entries.length < MIN_ENTRIES) return null;
	const coveredIndex = opts.coveredIndex ?? -1;
	let end: number;
	let tier: CompactionPlan["tier"];
	if (opts.covered) {
		end = entries.length - 1;
		tier = "full";
	} else if (coveredIndex >= 0) {
		end = shadowEnd(entries, coveredIndex);
		if (end < 0) return null;
		tier = "shrunk";
	} else {
		end = entries.length - 1;
		tier = "degraded";
	}
	return {
		throughEntryId: entries[end]!.id,
		shadowedIds: entries.slice(0, end + 1).map((entry) => entry.id),
		summary: tier === "degraded" ? qaCheckpointText(entries, end, opts) : memoryCheckpointText(entries, end, opts),
		shadowed: end + 1,
		tier,
	};
}
