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
	/** A request segment starts at this row (one user question → the next): renders a request dot. */
	requestMarks?: number;
}

/**
 * Records that open a turn block: they precede their run's first assistant in the log
 * (the run markers, the request head, and the reminders injected for the upcoming turn).
 */
const TURN_OPENERS = new Set(["system_prompt", "system_reminder", "turn/start", "step/start", "request/header"]);

/**
 * A record's band turn: assistant starts its own turn, toolResult keeps the turn of the
 * assistant that called the tool, user carries the turn that follows. Records that open a
 * turn (run/step markers, request heads) belong to the assistant they precede; everything
 * else (tool calls, results, step/end, send_message, turn/end, escalation, compaction)
 * belongs to the current turn. The log's own order is the display order, so turn numbers
 * along the log are non-decreasing — no reordering happens downstream.
 */
function turnFor(r: TrajectoryRecord, turnOf: number): number {
	if (r.kind === "assistant" || r.kind === "toolResult") return r.turn;
	if (r.kind === "user") return turnOf + 1;
	if (r.kind === "custom" && TURN_OPENERS.has(r.customType)) return turnOf + 1;
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
	// The log's append order is the display order (user → run markers → request head →
	// assistant → tools → step/end → … → send_message → turn/end), and turn assignment above
	// is non-decreasing along it — no sort, no intra-block reordering.
	// Dedupe for readability: one system_prompt total (the first), and one request/header
	// (the first, placed right under the system prompt — the tool definitions are static per
	// partner, so repeating a header per STEP would only add noise).
	const promptNode = nodes.find((n) => n.record.kind === "custom" && n.record.customType === "system_prompt");
	const headerNode = nodes.find((n) => n.record.kind === "custom" && n.record.customType === "request/header");
	let sawPrompt = false;
	const out: TimelineNode[] = [];
	for (const n of nodes) {
		const r = n.record;
		if (r.kind === "custom" && r.customType === "system_prompt") {
			if (sawPrompt) continue;
			sawPrompt = true;
		}
		out.push(n);
	}
	if (promptNode && headerNode) {
		const promptIdx = out.indexOf(promptNode);
		const headerIdx = out.indexOf(headerNode);
		if (promptIdx >= 0 && headerIdx >= 0 && headerIdx !== promptIdx + 1) {
			out.splice(headerIdx, 1);
			out.splice(promptIdx + 1, 0, headerNode);
		}
	}
	// Request segments: from a user question to the next user question (or the end) counts as
	// one request — its dot renders on the question row that starts the segment.
	for (const n of out) {
		if (n.record.kind === "user") n.requestMarks = 1;
	}
	return { nodes: out, turns };
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
