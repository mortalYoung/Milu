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
import type { SessionStore } from "../persist";
import { EVENTS } from "../persist/events";

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
 * Tool-pairing balance: a tool_result must never survive without the assistant that called it —
 * the API 400s on a tool message with no preceding tool_calls. Pairing is not adjacency: a
 * send_message persisted mid-tool (see surface.pairToolResults) can sit between the call and its
 * result, so scan the tail for results owned by shadowed assistants and extend the range to cover
 * them. Iterate to a fixpoint: extending shadows intervening assistants that may own results of
 * their own.
 */
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
	const range = selectCompactableRange(entries, surface.nodes, tailBudget);
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
	// The transaction appends into the target root — one scope per agent owns its root's appends
	const scope = session.scope(dir);
	await scope.appendCompactionRecord("compaction/start", { range: plan.range, generation: nextGen }, ts);
	const checkpointId = await scope.appendCompactionSummary(plan.checkpointText, ts);
	await scope.appendSurfaceOp({ op: "replace", start: plan.range.start, end: plan.range.end, sourceEventSeqs, replaceGeneration: nextGen, checkpointId }, ts);
	await scope.appendCompactionRecord("compaction/end", { ok: true, shadowed: shadowed.length }, ts);
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
		return "";
	}
	if (entry.type === "custom") {
		const data = entry.data as { text?: unknown; content?: unknown };
		if (typeof data.text === "string") return data.text;
		// Persisted tool/result events carry their content blocks (see persist/events.ts)
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

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
