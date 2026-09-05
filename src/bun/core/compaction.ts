import type { Entry } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { RequestTool } from "../../shared/rpc";
import type { Surface, SurfaceNode } from "../../shared/surface";
import type { SessionStore } from "../persist";
import { EVENTS } from "../persist/events";
import { formatMemoryRecord, type MemoryRecord } from "./memory";
import { frameSummary, localSummarizer, previousCheckpointText, type Summarizer } from "./summarizer";

export interface CompactRange {
	start: number;
	end: number;
}

export interface CompactionPlan {
	range: CompactRange;
	checkpointText: string;
	/** Legacy summarize path only; memory-backed compactions omit this. */
	summary?: string;
}

export interface CompactionOptions {
	tailBudget?: number;
	capChars?: number;
	summarizer?: Summarizer;
	systemPrompt?: string;
	tools?: RequestTool[];
	model?: Model<any>;
	signal?: AbortSignal;
}

const MEMORY_CHECKPOINT_PREAMBLE = "Earlier messages have been archived to this partner's long-term memory.";
const MEMORY_CHECKPOINT_EVENTS_HEADER = "Recent events before this checkpoint:";
const MEMORY_CHECKPOINT_FOOTER = "If you need details from before this checkpoint, call read_memory.";

function memoryCheckpointText(entries: Entry[], shadowed: SurfaceNode[], memoryEvents: MemoryRecord[], eventDigestCount: number): string {
	const shadowedIds = new Set(shadowed.map((n) => n.id));
	const indexById = new Map(entries.map((e, i) => [e.id, i]));
	const relevant = memoryEvents
		.filter((m) => m.kind === "event" && m.source.rawIds.some((id) => shadowedIds.has(id)))
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

export interface MemoryCompactionOptions {
	tailBudget?: number;
	eventDigestCount?: number;
	memoryEvents?: MemoryRecord[];
}

export async function planMemoryCompaction(entries: Entry[], surface: Surface, opts: MemoryCompactionOptions = {}): Promise<CompactionPlan | null> {
	const tailBudget = opts.tailBudget ?? 16;
	const range = selectCompactableRange(entries, surface.nodes, tailBudget);
	if (!range) return null;
	const shadowed = surface.nodes.slice(range.start, range.end + 1);
	return {
		range,
		checkpointText: memoryCheckpointText(entries, shadowed, opts.memoryEvents ?? [], opts.eventDigestCount ?? 5),
	};
}

export function selectCompactableRange(entries: Entry[], nodes: SurfaceNode[], tailBudget: number): CompactRange | null {
	if (nodes.length <= tailBudget + 1) return null;
	const byId = new Map(entries.map((e) => [e.id, e]));
	let end = nodes.length - tailBudget - 1;
	for (;;) {
		const calls = new Set<string>();
		for (let i = 0; i <= end; i++) {
			const entry = byId.get(nodes[i].id);
			if (!entry || entry.type !== "message" || entry.message.role !== "assistant") continue;
			const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
			for (const b of blocks) {
				if (b.type === "toolCall") calls.add((b as { id: string }).id);
			}
		}
		let grew = false;
		for (let j = end + 1; j < nodes.length; j++) {
			const entry = byId.get(nodes[j].id);
			if (!entry || entry.type !== "custom" || entry.customType !== EVENTS.toolResult) continue;
			const data = entry.data as { toolCallId?: unknown } | undefined;
			if (typeof data?.toolCallId === "string" && calls.has(data.toolCallId)) {
				end = j;
				grew = true;
			}
		}
		if (!grew) break;
	}
	return { start: 0, end };
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

export async function planCompaction(entries: Entry[], surface: Surface, opts: CompactionOptions = {}): Promise<CompactionPlan | null> {
	const tailBudget = opts.tailBudget ?? 16;
	const capChars = opts.capChars ?? 2000;
	const range = selectCompactableRange(entries, surface.nodes, tailBudget);
	if (!range) return null;
	const shadowed = surface.nodes.slice(range.start, range.end + 1);
	const summarizer = opts.summarizer ?? localSummarizer;
	const summary = await summarizer.summarize({
		entries,
		shadowed,
		systemPrompt: opts.systemPrompt ?? "",
		tools: opts.tools ?? [],
		model: opts.model,
		capChars,
		...(opts.signal ? { signal: opts.signal } : {}),
	});
	const baseline = fullTextLength(entries, shadowed);
	if (summary.length >= baseline) return null;
	// Keep the previous checkpoint (if shadowed) as a byte prefix so the provider's
	// prefix cache can still hit through it; cap the anchor so repeated compactions stay bounded.
	const previous = previousCheckpointText(entries, shadowed);
	const anchor = previous ? previous.slice(0, capChars) : undefined;
	return { range, summary, checkpointText: frameSummary(summary, anchor) };
}

export async function applyCompaction(session: SessionStore, dir: string, plan: CompactionPlan): Promise<void> {
	const ts = Date.now();
	const surface = await session.surface(dir);
	const nextGen = surface.replaceGeneration + 1;
	const shadowed = surface.nodes.slice(plan.range.start, plan.range.end + 1);
	const sourceEventSeqs = shadowed.map((n) => n.id);
	const scope = session.scope(dir);
	await scope.appendCompactionRecord("compaction/start", { range: plan.range, generation: nextGen }, ts);
	const checkpointId = await scope.appendCompactionSummary(plan.checkpointText, ts);
	await scope.appendSurfaceOp({ op: "replace", start: plan.range.start, end: plan.range.end, sourceEventSeqs, replaceGeneration: nextGen, checkpointId }, ts);
	await scope.appendCompactionRecord("compaction/end", { ok: true, shadowed: shadowed.length }, ts);
}

function fullTextLength(entries: Entry[], shadowed: SurfaceNode[]): number {
	const byId = new Map(entries.map((e) => [e.id, e]));
	let n = 0;
	for (const node of shadowed) {
		const entry = byId.get(node.id);
		if (entry) n += textOf(entry).length;
	}
	return n;
}

function textOf(entry: Entry): string {
	if (entry.type === "message") {
		const m = entry.message;
		if (m.role === "user") return typeof m.content === "string" ? m.content : contentText(m.content);
		if (m.role === "assistant") return contentText(m.content);
		return "";
	}
	if (entry.type === "custom") {
		const data = entry.data as { text?: unknown; content?: unknown };
		if (typeof data.text === "string") return data.text;
		if (entry.customType === "tool/result") return contentText(data.content);
		return "";
	}
	return "";
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as { type?: unknown; text?: unknown } | null;
			if (!block) return "";
			if (block.type === "text") return String(block.text ?? "");
			return "";
		})
		.join("\n");
}
