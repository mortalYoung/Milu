/**
 * Display-layer logic for trajectory views (pure functions, contract layer, shared by view and bun):
 * - timelineNodes: one node per log record with a turn number (assistant starts a turn; earlier
 *   entries carry the turn that follows them), plus whole-conversation turn summaries for the band.
 * - Tool pairing lives here (not in fold): a toolResult record is attached to its turn's tool call
 *   by callId; a call with no matching result is the interrupted marker.
 */
import type { TrajectoryBlock, TrajectoryRecord } from "./rpc";

/** One turn's summary for the density band. */
export interface TurnSummary {
	turn: number;
	time: number;
	tokens: number;
	/** Tool calls with their arguments; `result` is set when a matching toolResult record followed. */
	tools: { name: string; args: string; result?: { text: string; isError: boolean } }[];
	/** First non-empty text line of the turn, else the first tool name. */
	caption: string;
	/** Full assistant text of the turn (markdown), when present. */
	text?: string;
	/** Whether this turn delivered a visible send_message. */
	hasMessage: boolean;
	/** Token-workload bucket: light / medium / heavy. */
	density: "l1" | "l2" | "l3";
}

/** One node of the timeline: a log record plus its band turn. */
export interface TimelineNode {
	seq: number;
	turn: number;
	record: TrajectoryRecord;
	/** Band-only mark: the record's position shows in the band, its content is not a list row. */
	positionOnly?: boolean;
	/** Request headers floating a dot on this row (the request positions right before it in the log). */
	requestMarks?: number;
}

/**
 * A record's band turn: assistant starts its own turn, toolResult keeps the turn of the
 * assistant that called the tool, user carries the turn that follows. Everything else
 * (send_message and log-only records like request/header or surface ops) belongs to the
 * current turn — mid-turn records must never push the band past the turn of the tool
 * results that follow them (an inner-loop request/header sits between the assistant and
 * its toolResults, so "turn of the next assistant" would regress the sequence 1,2,1).
 */
function turnFor(r: TrajectoryRecord, turnOf: number): number {
	if (r.kind === "assistant" || r.kind === "toolResult") return r.turn;
	if (r.kind === "user") return turnOf + 1;
	return turnOf || 1;
}

/** The whole-log view model: one node per record, plus per-turn summaries for the band. */
export function timelineNodes(records: TrajectoryRecord[]): { nodes: TimelineNode[]; turns: TurnSummary[] } {
	const nodes: TimelineNode[] = [];
	const turns: TurnSummary[] = [];
	let turnOf = 0; // last assistant turn seen; only user records carry the turn that follows them
	let current: TurnSummary | null = null;
	let openResults = new Map<string, number>(); // toolCallId → index in the current turn's tools
	for (const r of records) {
		switch (r.kind) {
			case "assistant": {
				turnOf = r.turn;
				const ids = r.blocks.filter((b) => b.type === "toolCall").map((b) => String(b.id ?? ""));
				const tools = r.blocks.filter((b) => b.type === "toolCall").map((b) => ({ name: String(b.name ?? ""), args: stringifyArgs(b.arguments) }));
				const text = textBlocks(r.blocks).join("\n");
				current = {
					turn: r.turn,
					time: r.time,
					tokens: r.usage?.totalTokens ?? 0,
					tools,
					caption: firstLine(text) ?? tools[0]?.name ?? "",
					text: text || undefined,
					hasMessage: false,
					density: tokensToDensity(r.usage?.totalTokens ?? 0),
				};
				openResults = new Map(ids.map((id, i) => [id, i]));
				turns.push(current);
				break;
			}
			case "toolResult":
				if (current && current.turn === r.turn) {
					const i = openResults.get(r.toolCallId);
					if (i != null) current.tools[i] = { ...current.tools[i], result: { text: r.content, isError: r.isError } };
				}
				break;
			case "custom":
				if (r.customType === "send_message" && current) current.hasMessage = true;
				break;
		}
		nodes.push({ seq: r.seq, turn: turnFor(r, turnOf), record: r });
	}
	// Display order within a turn block (the band and the list share it): system_prompt →
	// request/header (the head, showing tools) → user question → reminder → send_message →
	// everything else in log order. Turn blocks themselves stay chronological.
	nodes.sort((a, b) => a.turn - b.turn || blockRank(a.record) - blockRank(b.record) || a.seq - b.seq);
	// Dedupe for readability: one system_prompt total (the first). Request headers are not
	// rows at all — every one is a band-only position mark that floats a dot on the row
	// following it in log order (their content is the request that produced that row).
	let sawPrompt = false;
	const out: TimelineNode[] = [];
	for (const n of nodes) {
		const r = n.record;
		if (r.kind === "custom") {
			if (r.customType === "system_prompt") {
				if (sawPrompt) continue;
				sawPrompt = true;
			} else if (r.customType === "request/header") {
				n.positionOnly = true;
			}
		}
		out.push(n);
	}
	const rows = out.filter((n) => !n.positionOnly).sort((a, b) => a.seq - b.seq);
	for (const n of out) {
		if (!n.positionOnly) continue;
		const target = rows.find((r) => r.seq > n.seq);
		if (target) target.requestMarks = (target.requestMarks ?? 0) + 1;
	}
	return { nodes: out, turns };
}

/** Sort rank of a record inside its turn block. */
function blockRank(r: TrajectoryRecord): number {
	if (r.kind === "user") return 2;
	if (r.kind === "custom") {
		switch (r.customType) {
			case "system_prompt":
				return 0;
			case "request/header":
				return 1;
			case "system_reminder":
				return 3;
			case "send_message":
				return 4;
		}
	}
	return 5;
}

/** Text blocks of an assistant record, in order (thinking/toolCall/image never count as text). */
function textBlocks(blocks: TrajectoryBlock[]): string[] {
	return blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? ""));
}

/** First non-empty line, or null. */
function firstLine(text: string): string | null {
	const line = text.split("\n").find((l) => l.trim());
	return line ?? null;
}

/** toolCall arguments: objects JSON-stringified as-is (indent 2), strings pass through unchanged. */
export function stringifyArgs(args: unknown): string {
	if (typeof args === "string") return args;
	if (args == null) return "";
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

/** Bucket by token workload: <1k light, <4k medium, else heavy (visual budget goes to what varies). */
function tokensToDensity(tokens: number): "l1" | "l2" | "l3" {
	if (tokens < 1000) return "l1";
	if (tokens < 4000) return "l2";
	return "l3";
}
