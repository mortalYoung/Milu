/**
 * Timeline folding — projectTimeline(origin) for the Trajectory drawer.
 *
 * Pure and shared by server and renderer. Timeline is NOT part of the Origin/Slice/View trio:
 * it is a debug/trace view that maps every Origin entry to one record (≈1:1, entryId equal),
 * with display-level request/header dedup applied at projection time.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import { entryKey } from "./entry-meta";
import type { TrajectoryBlock, TrajectoryRecord, TrajectoryUsage } from "./rpc";

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

export function toUsage(raw: RawUsage): Usage {
	return {
		input: raw.input ?? 0,
		output: raw.output ?? 0,
		cacheRead: raw.cacheRead ?? 0,
		cacheWrite: raw.cacheWrite ?? 0,
		totalTokens: raw.totalTokens ?? 0,
	};
}

export function toTrajectoryUsage(raw: RawUsage | undefined): TrajectoryUsage | undefined {
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

export function contentText(content: unknown): string {
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

function eventNumber(entry: Entry, field: string, fallback: number): number {
	if (entry.type !== "custom") return fallback;
	const value = (entry.data as Record<string, unknown> | undefined)?.[field];
	return typeof value === "number" ? value : fallback;
}

function upcomingRuns(entries: Entry[]): number[] {
	const upcoming = new Array<number>(entries.length).fill(0);
	let next = 0;
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === "agent/start") next = eventNumber(entry, "run", next);
		upcoming[i] = next;
	}
	return upcoming;
}

export function fold(entries: Entry[]): TrajectoryRecord[] {
	const records: TrajectoryRecord[] = [];
	const upcoming = upcomingRuns(entries);
	let run = 0;
	let turn = 0;
	let open = false;
	const push = (record: TrajectoryRecord) => {
		records.push({ ...record, seq: records.length });
	};
	for (let i = 0; i < entries.length; i += 1) {
		const entry = entries[i];
		const custom = entry.type === "custom" ? entry.customType : null;
		if (custom === "agent/start") {
			run = eventNumber(entry, "run", run + 1);
			turn = 0;
			open = true;
		} else if (custom === "turn/start") {
			turn = eventNumber(entry, "turn", turn + 1);
		}
		const placement = open ? { run, turn: turn || 1 } : { run: upcoming[i] || run + 1, turn: 1 };
		const base = { seq: 0, entryId: entry.id, metaKey: entryKey(entry), time: entry.timestamp, ...placement };

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
					const skill = (m as { skill?: unknown }).skill;
					push({
						...base,
						kind: "user",
						content: typeof m.content === "string" ? m.content : contentText(m.content),
						...(typeof skill === "string" ? { skillName: skill } : {}),
					});
				} else if (m.role === "assistant") {
					push({
						...base,
						kind: "assistant",
						blocks: (m.content as unknown as TrajectoryBlock[]) ?? [],
						api: m.api,
						provider: m.provider,
						model: m.model,
						responseModel: m.responseModel,
						responseId: m.responseId,
						timing: (m as { timing?: { turnStartTime: number; firstTokenTime: number | null; completedTime: number } }).timing,
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
		if (custom === "agent/end") open = false;
	}
	return records;
}

/**
 * Deduplicate request/header records by their tool-set content: keep only the first
 * occurrence of each distinct header (headers with a different tool set stay visible).
 * Display-layer rule, applied at projection time.
 */
export function dedupeRequestHeaders(records: TrajectoryRecord[]): TrajectoryRecord[] {
	const seen = new Set<string>();
	return records.filter((r) => {
		if (r.kind !== "custom" || r.customType !== "request/header") return true;
		const data = (r.data ?? {}) as { systemPrompt?: unknown; toolNames?: unknown };
		const key = JSON.stringify({ systemPrompt: data.systemPrompt ?? null, toolNames: data.toolNames ?? null });
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
