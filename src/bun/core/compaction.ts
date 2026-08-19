/**
 * Compaction: surface-only history rewriting (the log stays append-only — SSOT).
 *
 * Adapted from the deepseek-harness compaction design (docs/2026-08-19-session-surface-refactor.md):
 * - selectCompactableRange: head-anchored selection with a tail budget and tool-pairing balance
 *   (never cut between an assistant's toolCall and its tool_result);
 * - planCompaction: build the checkpoint summary; abort when it is not meaningfully smaller
 *   than the shadowed content (the transaction never touches the log in that case);
 * - applyCompaction: persist the transaction as append-only log entries
 *   (compaction/start → compaction_summary → surface_op → compaction/end). foldSurface applies
 *   the surface_op and inserts the compaction_summary as the replacement checkpoint node.
 *
 * The default summarizer is deterministic (compact Q/A transcript) so the machinery is testable
 * and safe without an LLM call; an LLM-backed summarizer can be plugged in via the same shape.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import type { Surface, SurfaceNode } from "../../shared/surface";
import type { SessionStore } from "./session";

export interface CompactRange {
	start: number;
	end: number;
}

export interface CompactionPlan {
	range: CompactRange;
	summary: string;
	/** The checkpoint user-message text the model sees in place of the shadowed range. */
	checkpointText: string;
}

/**
 * Head-anchored selection: compact everything before the last `tailBudget` nodes.
 * Tool-pairing balance: if the boundary cuts right after an assistant that still has a
 * tool_result, extend the range to include the result (a dangling tool call must not
 * reach the model without its result).
 */
export function selectCompactableRange(nodes: SurfaceNode[], tailBudget: number): CompactRange | null {
	if (nodes.length <= tailBudget + 1) return null;
	let end = nodes.length - tailBudget - 1;
	while (end + 1 < nodes.length && nodes[end].kind === "assistant" && nodes[end + 1].kind === "tool_result") {
		end += 1;
	}
	return { start: 0, end };
}

/** Compact Q/A transcript of the shadowed nodes (one line per visible message/tool result). */
export function summarizeShadowed(entries: Entry[], shadowed: SurfaceNode[], cap: number): string {
	const byId = new Map(entries.map((e) => [e.id, e]));
	const lines: string[] = [];
	for (const node of shadowed) {
		const entry = byId.get(node.id);
		if (!entry) continue;
		const text = oneLine(textOf(entry)).slice(0, 80);
		if (!text) continue;
		if (node.kind === "user") lines.push(`Q: ${text}`);
		else if (node.kind === "send_message") lines.push(`A: ${text}`);
		else if (node.kind === "tool_result") lines.push(`[tool] ${text}`);
	}
	const joined = lines.join("\n");
	return joined.length > cap ? joined.slice(0, cap) + "\n…" : joined;
}

/** Build the compaction plan, or null when there is nothing worth compacting. */
export function planCompaction(entries: Entry[], surface: Surface, tailBudget = 8, cap = 2000): CompactionPlan | null {
	const range = selectCompactableRange(surface.nodes, tailBudget);
	if (!range) return null;
	const shadowed = surface.nodes.slice(range.start, range.end + 1);
	const raw = summarizeShadowed(entries, shadowed, Number.POSITIVE_INFINITY);
	if (raw.length >= fullTextLength(entries, shadowed)) {
		// The summary is not smaller than the shadowed content → abort, surface unchanged
		return null;
	}
	const summary = raw.length > cap ? raw.slice(0, cap) + "\n…" : raw;
	return {
		range,
		summary,
		checkpointText: `[compacted ${shadowed.length} earlier messages]\n${summary}`,
	};
}

/**
 * Persist a compaction as append-only log entries. All four writes are computed up front, so a
 * failure anywhere leaves the surface untouched (start/summary without an op are log-only noise).
 */
export async function applyCompaction(session: SessionStore, dir: string, plan: CompactionPlan): Promise<void> {
	const ts = Date.now();
	const surface = await session.surface(dir);
	const nextGen = surface.replaceGeneration + 1;
	const shadowed = surface.nodes.slice(plan.range.start, plan.range.end + 1);
	const sourceEventSeqs = shadowed.map((n) => n.id);
	await session.appendCompactionRecord("compaction/start", { range: plan.range, generation: nextGen }, ts);
	const checkpointId = await session.appendCompactionSummary(plan.checkpointText, ts);
	await session.appendSurfaceOp({ op: "replace", start: plan.range.start, end: plan.range.end, sourceEventSeqs, replaceGeneration: nextGen, checkpointId }, ts);
	await session.appendCompactionRecord("compaction/end", { ok: true, shadowed: shadowed.length }, ts);
}

/** Total raw text length of the shadowed nodes (the "content replaced" baseline). */
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
		if (m.role === "toolResult") return contentText(m.content);
		return "";
	}
	if (entry.type === "custom") {
		const data = entry.data as { text?: unknown };
		return typeof data.text === "string" ? data.text : "";
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

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
