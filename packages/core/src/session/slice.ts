import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";

import { EVENTS, reminderText, type ReminderType } from "./events.ts";

export interface SliceItem {
	readonly id: string;
	readonly message: AgentMessage;
}

interface SliceContext {
	readonly entry: Entry;
	readonly index: number;
	readonly entries: readonly Entry[];
	readonly out: SliceItem[];
	readonly keepDangling: boolean;
}

function custom(entry: Entry, type: string): Record<string, unknown> | null {
	if (entry.type !== "custom" || entry.customType !== type) return null;
	return (entry.data ?? {}) as Record<string, unknown>;
}

function stamp(entry: Entry, data: Record<string, unknown>): number {
	return typeof data["timestamp"] === "number" ? data["timestamp"] : (entry.timestamp ?? 0);
}

function push(ctx: SliceContext, message: AgentMessage | null): void {
	if (!message) return;
	ctx.out.push({ id: ctx.entry.id, message });
}

function textMessage(role: "user", text: string, timestamp: number): AgentMessage {
	return { role, content: text, timestamp } as AgentMessage;
}

function sendMessage(ctx: SliceContext): void {
	const data = custom(ctx.entry, EVENTS.sendMessage);
	if (!data) return;
	if (data["toolCallId"] === "harness-delivery") return;
	push(ctx, textMessage("user", typeof data["text"] === "string" ? data["text"] : "", stamp(ctx.entry, data)));
}

function memoryContext(ctx: SliceContext): void {
	const data = custom(ctx.entry, EVENTS.memoryContext);
	if (!data || typeof data["text"] !== "string" || data["text"].length === 0) return;
	push(ctx, textMessage("user", data["text"], stamp(ctx.entry, data)));
}

function reminder(ctx: SliceContext): void {
	const entry = ctx.entry;
	if (entry.type !== "custom") return;
	const data = (entry.data ?? {}) as Record<string, unknown>;
	push(ctx, textMessage("user", reminderText(entry.customType as ReminderType, data), stamp(entry, data)));
}

function message(ctx: SliceContext): void {
	if (ctx.entry.type !== "message") return;
	push(ctx, ctx.entry.message as AgentMessage);
}

function assistantToolCallIds(entry: Entry): string[] {
	if (entry.type !== "message" || entry.message.role !== "assistant") return [];
	const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
	return blocks.filter((block) => (block as { type?: unknown }).type === "toolCall").map((block) => String((block as { id?: unknown }).id ?? ""));
}

function assistant(ctx: SliceContext): void {
	const ids = assistantToolCallIds(ctx.entry);
	if (ids.length === 0) {
		message(ctx);
		return;
	}
	const firstId = ids[0];
	const hasResult = ctx.entries
		.slice(ctx.index + 1)
		.some((entry) => entry.type === "custom" && entry.customType === EVENTS.toolResult && (entry.data as { toolCallId?: unknown }).toolCallId === firstId);
	if (hasResult || ctx.keepDangling) message(ctx);
}

function toolResult(ctx: SliceContext): void {
	const data = custom(ctx.entry, EVENTS.toolResult);
	if (!data) return;
	const result = {
		role: "toolResult",
		toolCallId: typeof data["toolCallId"] === "string" ? data["toolCallId"] : "",
		toolName: typeof data["toolName"] === "string" ? data["toolName"] : "",
		content: Array.isArray(data["content"]) ? data["content"] : [],
		details: data["details"],
		usage: data["usage"],
		...(Array.isArray(data["addedToolNames"]) ? { addedToolNames: data["addedToolNames"] } : {}),
		isError: data["isError"] === true,
		timestamp: stamp(ctx.entry, data),
	} as unknown as AgentMessage;

	const item: SliceItem = { id: ctx.entry.id, message: result };
	const callId = String((result as unknown as { toolCallId?: unknown }).toolCallId ?? "");
	let owner = -1;
	for (let index = ctx.out.length - 1; index >= 0; index -= 1) {
		const prev = ctx.out[index]?.message;
		if (!prev || prev.role !== "assistant") continue;
		const blocks = Array.isArray(prev.content) ? prev.content : [];
		const ids = blocks.filter((block) => (block as { type?: unknown }).type === "toolCall").map((block) => String((block as { id?: unknown }).id ?? ""));
		if (ids.includes(callId)) {
			owner = index;
			break;
		}
	}
	if (owner < 0) {
		ctx.out.push(item);
		return;
	}
	let at = owner;
	while (at + 1 < ctx.out.length && ctx.out[at + 1]?.message.role === "toolResult") at += 1;
	ctx.out.splice(at + 1, 0, item);
}

function compaction(ctx: SliceContext): void {
	const data = custom(ctx.entry, EVENTS.compaction);
	if (!data) return;
	const checkpoint: SliceItem = {
		id: ctx.entry.id,
		message: textMessage("user", String(data["summary"] ?? ""), typeof data["timestamp"] === "number" ? data["timestamp"] : (ctx.entry.timestamp ?? 0)),
	};
	const shadowed = Array.isArray(data["shadowedIds"]) ? new Set(data["shadowedIds"] as string[]) : null;
	if (!shadowed) {
		ctx.out.length = 0;
		ctx.out.push(checkpoint);
		return;
	}
	const kept = ctx.out.filter((item) => !shadowed.has(item.id));
	ctx.out.length = 0;
	ctx.out.push(checkpoint, ...kept);
}

function rewind(ctx: SliceContext): void {
	const data = custom(ctx.entry, EVENTS.rewind);
	if (!data || data["targetId"] == null || typeof data["text"] !== "string") return;
	const shadowed = new Set((Array.isArray(data["shadowedIds"]) ? data["shadowedIds"] : []) as string[]);
	for (let index = ctx.out.length - 1; index >= 0; index -= 1) {
		const item = ctx.out[index];
		if (item && shadowed.has(item.id)) ctx.out.splice(index, 1);
	}
	const targetId = String(data["targetId"]);
	const at = ctx.out.findIndex((item) => item.id === targetId && item.message.role === "user");
	if (at < 0) return;
	const target = ctx.out[at]!;
	ctx.out[at] = { ...target, message: { ...(target.message as object), content: data["text"] } as AgentMessage };
}

const BY_CUSTOM: Record<string, (ctx: SliceContext) => void> = {
	[EVENTS.sendMessage]: sendMessage,
	[EVENTS.memoryContext]: memoryContext,
	[EVENTS.timeGapReminder]: reminder,
	[EVENTS.contextChanged]: reminder,
	[EVENTS.instructionsChanged]: reminder,
	[EVENTS.mcpChanged]: reminder,
	[EVENTS.toolResult]: toolResult,
	[EVENTS.compaction]: compaction,
	[EVENTS.rewind]: rewind,
};

function visit(ctx: SliceContext): void {
	if (ctx.entry.type === "message") {
		if (ctx.entry.message.role === "assistant") assistant(ctx);
		else message(ctx);
		return;
	}
	if (ctx.entry.type !== "custom") return;
	BY_CUSTOM[ctx.entry.customType]?.(ctx);
}

export function projectSlice(entries: readonly Entry[], options: { keepDangling?: boolean } = {}): AgentMessage[] {
	return projectSliceItems(entries, options).map((item) => item.message);
}

export function projectSliceItems(entries: readonly Entry[], options: { keepDangling?: boolean } = {}): SliceItem[] {
	const out: SliceItem[] = [];
	entries.forEach((entry, index) => visit({ entry, index, entries, out, keepDangling: options.keepDangling ?? false }));
	return out;
}
