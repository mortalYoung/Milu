/**
 * Trajectory folding: map persisted pi entries (Entry[]) onto TrajectoryRecord[].
 * Pure functions, no IO — clean inputs and outputs, easy to test.
 *
 * The fold is total: every entry becomes exactly one record (message-shaped kinds
 * normalized, everything else passed through verbatim), so the trajectory drawer
 * shows the whole origin log. Only mechanical shaping happens here:
 * - assistant content blocks travel raw (the view interprets thinking/text/toolCall);
 * - tool results are their own records (a lost result is visible by absence);
 * - turn counting: each assistant message is one turn; toolResult inherits the turn
 *   of the assistant that called the tool.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import type { TrajectoryBlock, TrajectoryRecord, TrajectoryUsage, UsageTotals } from "../../shared/rpc";

/** Loose shape of an assistant message content block (thinking/text/toolCall). */
interface ContentBlock {
	type?: unknown;
	text?: unknown;
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
	reasoning?: number;
	cost?: TrajectoryUsage["cost"];
}

/** Normalize a raw usage record to the stable four-field shape. */
function toUsage(raw: RawUsage): Usage {
	return {
		input: raw.input ?? 0,
		output: raw.output ?? 0,
		cacheRead: raw.cacheRead ?? 0,
		cacheWrite: raw.cacheWrite ?? 0,
		totalTokens: raw.totalTokens ?? 0,
	};
}

/** Normalize a raw usage record, retaining the provider extras (reasoning / cost). */
function toTrajectoryUsage(raw: RawUsage | undefined): TrajectoryUsage | undefined {
	if (!raw) return undefined;
	return {
		input: raw.input ?? 0,
		output: raw.output ?? 0,
		cacheRead: raw.cacheRead ?? 0,
		cacheWrite: raw.cacheWrite ?? 0,
		totalTokens: raw.totalTokens ?? 0,
		...("reasoning" in raw ? { reasoning: raw.reasoning } : {}),
		...("cost" in raw ? { cost: raw.cost } : {}),
	};
}

/**
 * The last assistant turn's token usage, or null when no assistant message carries usage.
 * Each LLM call sends the whole context, so the most recent request's prompt size is the
 * current context occupancy (the context_usage handler derives its numerator from this).
 */
/** Sum the usage of every persisted assistant turn (the composer's whole-session line). */
export function aggregateUsage(entries: Entry[]): UsageTotals | null {
	let totals: UsageTotals | null = null;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage) continue;
		const u = toUsage(msg.usage);
		totals ??= { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		totals.messages += 1;
		totals.input += u.input;
		totals.output += u.output;
		totals.cacheRead += u.cacheRead;
		totals.cacheWrite += u.cacheWrite;
	}
	return totals;
}

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

/** Fold the whole log: one record per entry, nothing dropped. */
export function fold(entries: Entry[]): TrajectoryRecord[] {
	const records: TrajectoryRecord[] = [];
	let turn = 0;
	const push = (record: TrajectoryRecord) => {
		records.push({ ...record, seq: records.length });
	};
	for (const entry of entries) {
		const base = { seq: 0, entryId: entry.id, time: entry.timestamp };
		// A persisted tool/result event answers its turn's tool call (the live loop writes it after the
		// assistant's message, so the log is already in display order — no deferral needed anymore)
		if (entry.type === "custom" && entry.customType === "tool/result") {
			const data = (entry.data ?? {}) as {
				toolCallId?: unknown;
				toolName?: unknown;
				content?: unknown;
				details?: unknown;
				usage?: unknown;
				addedToolNames?: unknown;
				isError?: unknown;
			};
			push({
				...base,
				kind: "toolResult",
				turn,
				toolCallId: String(data.toolCallId ?? ""),
				toolName: String(data.toolName ?? ""),
				content: contentText(data.content),
				details: data.details,
				usage: toTrajectoryUsage(data.usage as RawUsage | undefined),
				addedToolNames: Array.isArray(data.addedToolNames) ? data.addedToolNames.map(String) : undefined,
				isError: data.isError === true,
			});
			continue;
		}
		switch (entry.type) {
			case "message": {
				const m = entry.message;
				if (m.role === "user") {
					push({ ...base, kind: "user", content: typeof m.content === "string" ? m.content : contentText(m.content) });
				} else if (m.role === "assistant") {
					turn += 1;
					push({
						...base,
						kind: "assistant",
						turn,
						blocks: (m.content as unknown as TrajectoryBlock[]) ?? [],
						api: m.api,
						provider: m.provider,
						model: m.model,
						responseModel: m.responseModel,
						responseId: m.responseId,
						usage: toTrajectoryUsage(m.usage),
						stopReason: m.stopReason,
						errorMessage: m.errorMessage,
						rawStopReason: m.rawStopReason,
					});
				}
				break;
			}
			case "model_change":
				push({ ...base, kind: "modelChange", provider: entry.provider, modelId: entry.modelId });
				break;
			case "thinking_level_change":
				push({ ...base, kind: "thinkingLevel", thinkingLevel: entry.thinkingLevel });
				break;
			case "active_tools_change":
				push({ ...base, kind: "activeTools", activeToolNames: entry.activeToolNames });
				break;
			case "compaction":
				push({
					...base,
					kind: "compaction",
					summary: entry.summary,
					retainedTailCount: entry.retainedTail.length,
					tokensBefore: entry.tokensBefore,
					details: entry.details,
					usage: toTrajectoryUsage(entry.usage),
				});
				break;
			case "branch_summary":
				push({ ...base, kind: "branchSummary", fromId: entry.fromId, summary: entry.summary, details: entry.details, usage: toTrajectoryUsage(entry.usage) });
				break;
			case "custom":
				push({ ...base, kind: "custom", customType: entry.customType, data: entry.data });
				break;
		}
	}
	return records;
}

/** Content block array → text (image blocks are placeholders); strings pass through unchanged. */
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as ContentBlock | null;
			if (!block) return "";
			if (block.type === "text") return String(block.text ?? "");
			if (block.type === "image") return "(image)";
			return "";
		})
		.join("\n");
}
