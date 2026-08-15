/**
 * Display-layer logic for trajectory views (pure functions, contract layer, shared by view and bun):
 * - segmentForMessage: a visible message's trajectory = the records from the nearest user message
 *   (inclusive) up to and including this message;
 * - turnsFromRecords: whole-conversation turn summaries for the density strip (B).
 */
import type { TrajectoryRecord } from "./rpc";

/** One turn's summary for the density strip. */
export interface TurnSummary {
	turn: number;
	time: number;
	tokens: number;
	/** Tool calls with their arguments (shown in the turn detail). */
	tools: { name: string; args: string }[];
	/** First non-empty text line of the turn, else the first tool name. */
	caption: string;
	/** Full assistant text of the turn (markdown), when present. */
	text?: string;
	/** Whether this turn delivered a visible send_message. */
	hasMessage: boolean;
	/** pi id of the delivered message (chat linkage); set when hasMessage. */
	messageId?: string;
	/** Token-workload bucket: light / medium / heavy. */
	density: "l1" | "l2" | "l3";
}

/** A user question, used as a milestone marker on the strip. */
export interface UserMilestone {
	time: number;
	question: string;
	messageId: string;
}

/** A persisted system prompt (shown collapsible; also a strip column). */
export interface SystemSummary {
	text: string;
	time: number;
}

/** One node of the conversation timeline (system prompt / user / reminder / assistant / tool / message). */
export interface TrajectoryNode {
	kind: "system" | "user" | "reminder" | "assistant" | "tool" | "message";
	/** The turn this node belongs to (user/system/reminder carry the turn that follows them). */
	turn: number;
	seq: number;
	time: number;
	/** Text for system/user/reminder/assistant/message nodes. */
	text?: string;
	/** Assistant node: the model's internal reasoning (shown collapsible in the detail). */
	thinking?: string;
	/** Tool node: tool name, arguments and result. */
	toolName?: string;
	args?: string;
	result?: { text: string; isError: boolean };
	/** Assistant node: token workload and density bucket. */
	tokens?: number;
	density?: "l1" | "l2" | "l3";
	/** User/message node: pi id for chat linkage. */
	messageId?: string;
}

/** Whole-conversation view model: every record as a timeline node, plus per-turn summaries for density and selection. */
export function trajectoryNodes(records: TrajectoryRecord[]): { nodes: TrajectoryNode[]; turns: TurnSummary[] } {
	const nodes: TrajectoryNode[] = [];
	const systems: TrajectoryNode[] = [];
	const turns: TurnSummary[] = [];
	let current: TurnSummary | null = null;
	let turnOf = 0; // last assistant turn seen; user/reminder carry the turn that follows them
	for (const r of records) {
		switch (r.kind) {
			case "user":
				nodes.push({ kind: "user", turn: turnOf + 1, seq: r.seq, time: r.time, text: r.text, messageId: r.id });
				break;
			case "system":
				// System prompts precede the whole conversation; collapse consecutive identical ones
				// (redundant partner switches used to pile them up) and keep them at the timeline start
				if (systems.at(-1)?.text === r.text) break;
				systems.push({ kind: "system", turn: 1, seq: r.seq, time: r.time, text: r.text });
				break;
			case "reminder":
				nodes.push({ kind: "reminder", turn: turnOf + 1, seq: r.seq, time: r.time, text: r.text });
				break;
			case "assistant": {
				turnOf = r.turn;
				current = {
					turn: r.turn,
					time: r.time,
					tokens: r.usage?.totalTokens ?? 0,
					tools: [],
					caption: r.text?.split("\n").find((l) => l.trim()) ?? "",
					text: r.text,
					hasMessage: false,
					density: tokensToDensity(r.usage?.totalTokens ?? 0),
				};
				turns.push(current);
				nodes.push({
					kind: "assistant",
					turn: r.turn,
					seq: r.seq,
					time: r.time,
					text: r.text,
					thinking: r.thinking,
					tokens: r.usage?.totalTokens ?? 0,
					density: current.density,
				});
				break;
			}
			case "tool":
				if (current && current.turn === r.turn) {
					current.tools.push({ name: r.name, args: r.args });
					if (!current.caption) current.caption = r.name;
				}
				nodes.push({ kind: "tool", turn: r.turn, seq: r.seq, time: r.time, toolName: r.name, args: r.args, result: r.result });
				break;
			case "message":
				if (current) {
					current.hasMessage = true;
					current.messageId = r.id;
				}
				nodes.push({ kind: "message", turn: turnOf, seq: r.seq, time: r.time, text: r.text, messageId: r.id });
				break;
		}
	}
	return { nodes: [...systems, ...nodes], turns };
}

/** Bucket by token workload: <1k light, <4k medium, else heavy (visual budget goes to what varies). */
function tokensToDensity(tokens: number): "l1" | "l2" | "l3" {
	if (tokens < 1000) return "l1";
	if (tokens < 4000) return "l2";
	return "l3";
}

/** Returns [] when the message cannot be found. */
export function segmentForMessage(records: TrajectoryRecord[], messageId: string): TrajectoryRecord[] {
	let end = -1;
	for (let i = records.length - 1; i >= 0; i--) {
		const r = records[i];
		if (r.kind === "message" && r.id === messageId) {
			end = i;
			break;
		}
	}
	if (end === -1) return [];
	let start = end;
	while (start >= 0 && records[start].kind !== "user") start--;
	return records.slice(Math.max(0, start), end + 1);
}
