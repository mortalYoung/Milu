import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENTS } from "../persist/events";
import { extractionEntries, formatMemoryRecord, type MemoryKind, type MemoryRecord } from "./memory";

const MIN_ENTRIES = 8;
const DEFAULT_DIGEST_MAX_ITEMS = 10;
const EVENT_RESERVED = 3;
const QA_PAIRS = 5;
const QA_MAX_CHARS = 200;

const MEMORY_CHECKPOINT_PREAMBLE = "Earlier messages have been archived to this partner's long-term memory.";
const MEMORY_CHECKPOINT_DIGEST_HEADER = "Recent memories before this checkpoint:";
const MEMORY_CHECKPOINT_FOOTER = 'If you need details from before this checkpoint, call memory with op "read".';
const REMOVED_CHECKPOINT_PREAMBLE = "Earlier messages were removed from the active context to keep the conversation within the model's window; they remain in the session log.";
const QA_HEADER = "Recent Q/A:";

const DIGEST_KIND_ORDER: MemoryKind[] = ["decision", "issue", "preference", "instruction", "fact", "reference"];

export type CompactionTier = "full" | "shrunk" | "degraded";

export interface CompactionPlan {
	throughEntryId: string;
	shadowedIds: string[];
	checkpointText: string;
	shadowed: number;
	tier: CompactionTier;
}

export interface MemoryCompactionOptions {
	digestMaxItems?: number;
	memoryEvents?: MemoryRecord[];
	covered?: boolean;
	coveredIndex?: number;
	memoryAvailable?: boolean;
}

function isUserMessage(entry: Entry): boolean {
	return entry.type === "message" && entry.message.role === "user";
}

function shadowEnd(entries: Entry[], covered: number): number {
	for (let u = covered + 1; u >= 0; u--) {
		const entry = entries[u];
		if (entry && isUserMessage(entry)) return u - 1;
	}
	return -1;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const b = block as { type?: unknown; text?: unknown };
		if (b && b.type === "text" && typeof b.text === "string") parts.push(b.text);
	}
	return parts.join(" ");
}

function oneLine(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > QA_MAX_CHARS ? `${line.slice(0, QA_MAX_CHARS)}…` : line;
}

function recentQa(entries: Entry[], limit: number): string {
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

function previousCompactionEnd(entries: Entry[], endIndex: number): number {
	for (let i = endIndex; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== EVENTS.compaction) continue;
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

function selectDigest(records: MemoryRecord[], indexById: Map<string, number>, spanStart: number, endIndex: number, max: number): MemoryRecord[] {
	const inSpan = records.map((record) => ({ record, at: firstIndex(record, indexById) })).filter((item) => item.at >= spanStart && item.at <= endIndex);
	if (inSpan.length === 0) return [];
	const events = inSpan.filter((item) => item.record.kind === "event").sort((a, b) => a.at - b.at);
	const keepEvents = events.slice(-EVENT_RESERVED);
	const durable = inSpan
		.filter((item) => item.record.kind !== "event")
		.sort((a, b) => kindRank(a.record.kind) - kindRank(b.record.kind) || b.at - a.at)
		.slice(0, Math.max(0, max - keepEvents.length));
	return [...keepEvents, ...durable].sort((a, b) => a.at - b.at).map((item) => item.record);
}

function memoryCheckpointText(entries: Entry[], endIndex: number, opts: MemoryCompactionOptions): string {
	const indexById = new Map(entries.map((entry, i) => [entry.id, i]));
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

function qaCheckpointText(entries: Entry[], endIndex: number, opts: MemoryCompactionOptions): string {
	const parts = [REMOVED_CHECKPOINT_PREAMBLE];
	const qa = recentQa(entries.slice(0, endIndex + 1), QA_PAIRS);
	if (qa) parts.push(QA_HEADER, qa);
	if (opts.memoryAvailable) parts.push(MEMORY_CHECKPOINT_FOOTER);
	return parts.join("\n");
}

export async function planMemoryCompaction(entries: Entry[], opts: MemoryCompactionOptions = {}): Promise<CompactionPlan | null> {
	if (entries.length < MIN_ENTRIES) return null;
	const coveredIndex = opts.coveredIndex ?? -1;
	let end: number;
	let tier: CompactionTier;
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
		throughEntryId: entries[end].id,
		shadowedIds: entries.slice(0, end + 1).map((entry) => entry.id),
		checkpointText: tier === "degraded" ? qaCheckpointText(entries, end, opts) : memoryCheckpointText(entries, end, opts),
		shadowed: end + 1,
		tier,
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
			appendCompaction(details: { summary: string; throughEntryId: string; shadowedIds: string[]; tier: CompactionTier }, timestamp: number): Promise<string>;
		};
	},
	dir: string,
	plan: CompactionPlan,
): Promise<void> {
	const ts = Date.now();
	const scope = session.scope(dir);
	await scope.appendCompactionRecord("compaction/start", {}, ts);
	await scope.appendCompaction({ summary: plan.checkpointText, throughEntryId: plan.throughEntryId, shadowedIds: plan.shadowedIds, tier: plan.tier }, ts);
	await scope.appendCompactionRecord("compaction/end", { ok: true, shadowed: plan.shadowed, tier: plan.tier }, ts);
}
