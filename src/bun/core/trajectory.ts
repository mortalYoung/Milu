import type { Entry } from "@earendil-works/pi-agent-core";
import type { TrajectoryBlock, TrajectoryRecord, TrajectoryUsage, UsageTotals } from "../../shared/rpc";

interface ContentBlock {
	type?: unknown;
	text?: unknown;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
}

interface RawUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	reasoning?: number;
	cost?: TrajectoryUsage["cost"];
}

function toUsage(raw: RawUsage): Usage {
	return {
		input: raw.input ?? 0,
		output: raw.output ?? 0,
		cacheRead: raw.cacheRead ?? 0,
		cacheWrite: raw.cacheWrite ?? 0,
		totalTokens: raw.totalTokens ?? 0,
	};
}

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

export function lastTrajectoryUsage(entries: Entry[]): TrajectoryUsage | null {
	let last: TrajectoryUsage | null = null;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage) continue;
		const u = toTrajectoryUsage(msg.usage);
		if (u) last = u;
	}
	return last;
}

export function fold(entries: Entry[]): TrajectoryRecord[] {
	const records: TrajectoryRecord[] = [];
	let turn = 0;
	const push = (record: TrajectoryRecord) => {
		records.push({ ...record, seq: records.length });
	};
	for (const entry of entries) {
		const base = { seq: 0, entryId: entry.id, time: entry.timestamp };

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
						timing: (m as { timing?: { stepStartTime: number; firstTokenTime: number | null; completedTime: number } }).timing,
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
