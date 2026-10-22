import type { SeqEntry } from "@milu/protocol";
import { LOG_EVENTS } from "@milu/protocol";

export type LogEntry = SeqEntry["entry"];

export type TrajectoryTone = "plain" | "user" | "skill" | "result" | "message" | "system" | "reminder" | "request" | "decision" | "change" | "compact" | "custom";

export interface TrajectoryDetail {
	label?: string;
	description?: string;
	content?: { kind: "text" | "code" | "json"; value: string };
	meta?: string[];
	error?: boolean;
}

export interface TrajectoryRow {
	chip?: string;
	tone?: TrajectoryTone;
	caption?: string;
	details?: TrajectoryDetail[];
}

export interface TrajectoryNode {
	chip?: string;
	tone?: TrajectoryTone;
	caption?: string;
	details?: TrajectoryDetail[];
	rows?: TrajectoryRow[];
}

export interface TrajectoryBlock {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	redacted?: unknown;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
}

export interface TrajectoryUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	reasoning?: number;
}

interface RecordBase {
	seq: number;
	entryId: string;
	metaKey: string;
	time: number;
	run: number;
	turn: number;
	marks?: number;
	sliceMessage?: unknown;
}

export type TrajectoryRecord =
	| (RecordBase & { kind: "user"; content: string; skillName?: string })
	| (RecordBase & {
			kind: "assistant";
			blocks: readonly TrajectoryBlock[];
			provider?: string;
			model?: string;
			api?: string;
			stopReason?: string;
			responseModel?: string;
			responseId?: string;
			usage?: TrajectoryUsage;
			errorMessage?: string;
	  })
	| (RecordBase & {
			kind: "toolResult";
			toolCallId: string;
			toolName: string;
			content: string;
			details?: unknown;
			usage?: TrajectoryUsage;
			isError: boolean;
	  })
	| (RecordBase & { kind: "custom"; customType: string; data?: unknown });

type Payload =
	| { kind: "user"; content: string; skillName?: string }
	| {
			kind: "assistant";
			blocks: readonly TrajectoryBlock[];
			provider?: string;
			model?: string;
			api?: string;
			stopReason?: string;
			responseModel?: string;
			responseId?: string;
			usage?: TrajectoryUsage;
			errorMessage?: string;
	  }
	| { kind: "toolResult"; toolCallId: string; toolName: string; content: string; details?: unknown; usage?: TrajectoryUsage; isError: boolean }
	| { kind: "custom"; customType: string; data?: unknown };

export interface TurnSummary {
	readonly run: number;
	readonly turn: number;
}

export function entryKey(entry: LogEntry): string {
	if (entry.type === "message") return `role:${entry.message.role}`;
	if (entry.type === "custom") return entry.customType;
	return entry.type;
}

export function dataOf(entry: LogEntry): Record<string, unknown> {
	return entry.type === "custom" && entry.data !== undefined && entry.data !== null ? (entry.data as Record<string, unknown>) : {};
}

function eventNumber(entry: LogEntry, field: string, fallback: number): number {
	const value = dataOf(entry)[field];
	return typeof value === "number" ? value : fallback;
}

export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const value = block as { type?: unknown; text?: unknown };
			return value.type === "text" ? String(value.text ?? "") : "";
		})
		.filter((text) => text !== "")
		.join("\n");
}

function usageOf(raw: unknown): TrajectoryUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const usage = raw as Record<string, unknown>;
	const num = (key: string): number => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
	const total = num("totalTokens") || num("input") + num("output") + num("cacheRead") + num("cacheWrite");
	return {
		input: num("input"),
		output: num("output"),
		cacheRead: num("cacheRead"),
		cacheWrite: num("cacheWrite"),
		totalTokens: total,
		...(typeof usage["reasoning"] === "number" ? { reasoning: usage["reasoning"] as number } : {}),
	};
}

function messagePayload(entry: LogEntry): Payload | null {
	if (entry.type !== "message") return null;
	const message = entry.message as {
		role: string;
		content?: unknown;
		skill?: unknown;
		provider?: unknown;
		model?: unknown;
		api?: unknown;
		stopReason?: unknown;
		responseModel?: unknown;
		responseId?: unknown;
		usage?: unknown;
		errorMessage?: unknown;
	};
	if (message.role === "user") {
		return {
			kind: "user",
			content: contentText(message.content),
			...(typeof message.skill === "string" ? { skillName: message.skill } : {}),
		};
	}
	if (message.role !== "assistant") return null;
	const blocks = Array.isArray(message.content) ? (message.content as TrajectoryBlock[]) : [];
	return {
		kind: "assistant",
		blocks,
		...(typeof message.provider === "string" ? { provider: message.provider } : {}),
		...(typeof message.model === "string" ? { model: message.model } : {}),
		...(typeof message.api === "string" ? { api: message.api } : {}),
		...(typeof message.stopReason === "string" ? { stopReason: message.stopReason } : {}),
		...(typeof message.responseModel === "string" ? { responseModel: message.responseModel } : {}),
		...(typeof message.responseId === "string" ? { responseId: message.responseId } : {}),
		...(usageOf(message.usage) ? { usage: usageOf(message.usage) } : {}),
		...(typeof message.errorMessage === "string" ? { errorMessage: message.errorMessage } : {}),
	};
}

function payloadOf(entry: LogEntry): Payload | null {
	if (entry.type === "message") return messagePayload(entry);
	if (entry.type === "model_change") return { kind: "custom", customType: "model_change", data: { provider: entry.provider, modelId: entry.modelId } };
	if (entry.type === "active_tools_change") return { kind: "custom", customType: "active_tools_change", data: { toolNames: entry.activeToolNames } };
	if (entry.type !== "custom") return null;
	if (entry.customType === LOG_EVENTS.toolResult) {
		const data = dataOf(entry);
		return {
			kind: "toolResult",
			toolCallId: String(data["toolCallId"] ?? ""),
			toolName: String(data["toolName"] ?? ""),
			content: contentText(data["content"]),
			...(data["details"] === undefined ? {} : { details: data["details"] }),
			...(usageOf(data["usage"]) ? { usage: usageOf(data["usage"]) } : {}),
			isError: data["isError"] === true,
		};
	}
	return { kind: "custom", customType: entry.customType, data: entry.data };
}

function upcomingRuns(entries: readonly LogEntry[]): number[] {
	const upcoming = Array.from({ length: entries.length }, () => 0);
	let next = 0;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index]!;
		if (entry.type === "custom" && entry.customType === LOG_EVENTS.agentStart) next = eventNumber(entry, "run", next);
		upcoming[index] = next;
	}
	return upcoming;
}

export function buildData(entries: readonly LogEntry[]): TrajectoryRecord[] {
	const upcoming = upcomingRuns(entries);
	const cursor = { run: 0, turn: 0, open: false };
	const out: TrajectoryRecord[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		const metaKey = entryKey(entry);
		if (metaKey === LOG_EVENTS.agentStart) {
			cursor.run = eventNumber(entry, "run", cursor.run + 1);
			cursor.turn = 0;
			cursor.open = true;
		}
		if (metaKey === LOG_EVENTS.turnStart) cursor.turn = eventNumber(entry, "turn", cursor.turn + 1);
		const payload = payloadOf(entry);
		if (payload) {
			const placement = cursor.open ? { run: cursor.run, turn: cursor.turn || 1 } : { run: upcoming[index] || cursor.run + 1, turn: 1 };
			out.push({ seq: out.length, entryId: entry.id, metaKey, time: entry.timestamp ?? 0, ...placement, ...payload } as TrajectoryRecord);
		}
		if (metaKey === LOG_EVENTS.agentEnd) cursor.open = false;
	}
	return out;
}
