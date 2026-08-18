/**
 * Trajectory folding: organize persisted pi entries (Entry[]) into TrajectoryRecord[].
 * Pure functions, no IO — clean inputs and outputs, easy to test.
 *
 * Rules:
 * - turns are counted by assistant messages (each LLM call = one turn);
 * - tool results are matched back to their turn's tool call by callId;
 * - tool calls still unpaired at the end (restart interruption/abort) → marked interrupted.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import type { TrajectoryRecord } from "../../shared/rpc";

/** Loose shape of an assistant message content block (thinking/text/toolCall). */
interface ContentBlock {
	type?: unknown;
	thinking?: unknown;
	text?: unknown;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
}

/** Provider-reported token usage of one assistant turn (fields default to 0 when absent). */
export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
}

/** Loose shape of a provider usage record (all fields optional; pi's Usage is assignable). */
interface RawUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
}

/** Normalize a raw usage record to the stable four-field shape. */
function toUsage(usage: RawUsage): Usage {
	return {
		input: usage.input ?? 0,
		output: usage.output ?? 0,
		cacheRead: usage.cacheRead ?? 0,
		cacheWrite: usage.cacheWrite ?? 0,
		totalTokens: usage.totalTokens ?? 0,
	};
}

/**
 * The last assistant turn's token usage, or null when no assistant message carries usage.
 * Each LLM call sends the whole context, so the most recent request's prompt size is the
 * current context occupancy (the context_usage handler derives its numerator from this).
 */
export function lastUsage(entries: Entry[]): Usage | null {
	let last: Usage | null = null;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage) continue;
		last = toUsage(msg.usage);
	}
	return last;
}

export function fold(entries: Entry[]): TrajectoryRecord[] {
	const records: TrajectoryRecord[] = [];
	// Placeholder for tool calls not yet paired within the current turn: callId → record index
	const pendingToolCalls = new Map<string, number>();
	let turn = 0;
	let seq = 0;

	for (const entry of entries) {
		if (entry.type === "custom") {
			if (entry.customType === "send_message") {
				const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
				records.push({ kind: "message", seq: seq++, id: entry.id, text: String(data.text ?? ""), time: Number(data.timestamp ?? entry.timestamp ?? 0) });
			} else if (entry.customType === "system_prompt") {
				const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
				records.push({ kind: "system", seq: seq++, text: String(data.text ?? ""), time: Number(data.timestamp ?? entry.timestamp ?? 0) });
			} else if (entry.customType === "system_reminder") {
				const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
				records.push({ kind: "reminder", seq: seq++, text: String(data.text ?? ""), time: Number(data.timestamp ?? entry.timestamp ?? 0) });
			}
			continue;
		}
		if (entry.type !== "message") continue;
		const msg = entry.message;
		const time = msg.timestamp ?? entry.timestamp ?? 0;

		if (msg.role === "user") {
			records.push({ kind: "user", seq: seq++, id: entry.id, text: typeof msg.content === "string" ? msg.content : contentText(msg.content), time });
		} else if (msg.role === "assistant") {
			turn += 1;
			const blocks = (msg.content as ContentBlock[]) ?? [];
			const thinking = blocks.find((b) => b.type === "thinking")?.thinking;
			const text = blocks.find((b) => b.type === "text")?.text;
			const usage = msg.usage;
			records.push({
				kind: "assistant",
				seq: seq++,
				turn,
				text: typeof text === "string" ? text : undefined,
				thinking: typeof thinking === "string" ? thinking : undefined,
				usage: usage ? toUsage(usage) : undefined,
				time,
			});
			for (const block of blocks) {
				if (block.type !== "toolCall") continue;
				const tool: TrajectoryRecord = {
					kind: "tool",
					seq: seq++,
					turn,
					callId: String(block.id ?? ""),
					name: String(block.name ?? ""),
					args: stringifyArgs(block.arguments),
					time,
				};
				pendingToolCalls.set(tool.callId, records.length);
				records.push(tool);
			}
		} else if (msg.role === "toolResult") {
			const target = pendingToolCalls.get(msg.toolCallId);
			if (target !== undefined) {
				pendingToolCalls.delete(msg.toolCallId);
				const rec = records[target];
				if (rec.kind === "tool") {
					rec.result = { text: contentText(msg.content), isError: Boolean(msg.isError) };
				}
			}
		}
	}

	for (const idx of pendingToolCalls.values()) {
		const rec = records[idx];
		if (rec.kind === "tool") rec.result = { text: "(interrupted)", isError: true };
	}
	return records;
}

/** Content block array → text (image blocks are placeholders); strings pass through unchanged. */
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as { type?: unknown; text?: unknown } | null;
			if (!block) return "";
			if (block.type === "text") return String(block.text ?? "");
			if (block.type === "image") return "(image)";
			return "";
		})
		.join("\n");
}

/** toolCall arguments: objects JSON-stringified as-is (indent 2), strings pass through unchanged. */
function stringifyArgs(args: unknown): string {
	if (typeof args === "string") return args;
	if (args == null) return "";
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}
