/**
 * Display-layer logic for trajectory views (pure functions, contract layer, shared by view and bun):
 * - timelineNodes: one node per log record plus one summary per turn for the band, and the request
 *   dots that mark where a user question opens a segment.
 */
import type { TrajectoryRecord } from "./rpc";

/** One turn's summary for the density band. */
export interface TurnSummary {
	run: number;
	turn: number;
	density: "l1" | "l2" | "l3";
}

/** One node of the timeline: a log record, plus the request dot its row shows. */
export interface TimelineNode {
	seq: number;
	record: TrajectoryRecord;
	requestMarks?: number;
}

/** The whole-log view model: one node per record, plus per-turn summaries for the band. */
export function timelineNodes(records: TrajectoryRecord[]): { nodes: TimelineNode[]; turns: TurnSummary[] } {
	const nodes: TimelineNode[] = [];
	const turns: TurnSummary[] = [];
	for (const record of records) {
		if (record.kind === "assistant") {
			turns.push({ run: record.run, turn: record.turn, density: tokensToDensity(record.usage?.totalTokens ?? 0) });
		}
		nodes.push({ seq: record.seq, record });
	}
	// The log's append order is the display order, so turn assignment is non-decreasing along it —
	// no sort, no intra-block reordering. Dedupe for readability: one system_prompt total (the
	// first), and one request/header (the first, placed right under the system prompt — the tool
	// definitions are static per partner, so repeating a header per turn would only add noise).
	const promptNode = nodes.find((n) => n.record.kind === "custom" && n.record.customType === "system_prompt");
	const headerNode = nodes.find((n) => n.record.kind === "custom" && n.record.customType === "request/header");
	let sawPrompt = false;
	const out: TimelineNode[] = [];
	for (const node of nodes) {
		const record = node.record;
		if (record.kind === "custom" && record.customType === "system_prompt") {
			if (sawPrompt) continue;
			sawPrompt = true;
		}
		out.push(node);
	}
	if (promptNode && headerNode) {
		const promptIdx = out.indexOf(promptNode);
		const headerIdx = out.indexOf(headerNode);
		if (promptIdx >= 0 && headerIdx >= 0 && headerIdx !== promptIdx + 1) {
			out.splice(headerIdx, 1);
			out.splice(promptIdx + 1, 0, headerNode);
		}
	}
	// Request segments: from a user question to the next user question (or the end) counts as one
	// request — its dot renders on the question row that starts the segment.
	for (const node of out) {
		if (node.record.kind === "user" && node.record.metaKey === "role:user") node.requestMarks = 1;
	}
	return { nodes: out, turns };
}

/** Bucket by token workload: <1k light, <4k medium, else heavy (visual budget goes to what varies). */
function tokensToDensity(tokens: number): "l1" | "l2" | "l3" {
	if (tokens < 1000) return "l1";
	if (tokens < 4000) return "l2";
	return "l3";
}
