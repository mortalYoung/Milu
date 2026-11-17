import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Entry } from "@milu/protocol";

import { EVENTS } from "./events.ts";
import { priceMessage } from "./tokens.ts";

export function priceEntry(entry: Entry): number {
	if (entry.type === "message") return priceMessage(entry.message as unknown as AgentMessage);
	try {
		return Math.ceil(JSON.stringify(entry).length / 4);
	} catch {
		return 0;
	}
}

export interface SpanCost {
	readonly shadowedTokens: number;
	readonly retainedTokens: number;
}

export function spanCost(entries: readonly Entry[], endIndex: number): SpanCost {
	const priced = entries.map(priceEntry);
	const total = priced.reduce((sum, value) => sum + value, 0);
	let shadowedTokens = 0;
	for (let index = 0; index <= endIndex && index < priced.length; index += 1) shadowedTokens += priced[index]!;
	return { shadowedTokens, retainedTokens: total - shadowedTokens };
}

function callsIn(entry: Entry): readonly string[] {
	if (entry.type !== "message" || entry.message.role !== "assistant") return [];
	const content = entry.message.content;
	if (!Array.isArray(content)) return [];
	return content.flatMap((block) => {
		const call = block as { type?: unknown; id?: unknown };
		return call.type === "toolCall" && typeof call.id === "string" ? [call.id] : [];
	});
}

function resultsIn(entry: Entry): readonly string[] {
	if (entry.type === "custom" && entry.customType === EVENTS.toolResult) {
		const callId = (entry.data as { toolCallId?: unknown } | undefined)?.toolCallId;
		return typeof callId === "string" ? [callId] : [];
	}
	if (entry.type === "message" && entry.message.role === "toolResult") {
		const callId = (entry.message as { toolCallId?: unknown }).toolCallId;
		return typeof callId === "string" ? [callId] : [];
	}
	return [];
}

/**
 * 尾巴必须从一条不带 tool 结果的位置开始：先退到认领者（assistant 的 tool_calls）之前，
 * 再跳过无人认领的结果，否则模型会收到「role 'tool' 没有前置 tool_calls」的 400。
 */
export function safeTailStart(entries: readonly Entry[], start: number): number {
	let at = start;
	while (at > 0 && splitsToolPair(entries, at)) at -= 1;
	while (at < entries.length && resultsIn(entries[at]!).length > 0) at += 1;
	return at;
}

function splitsToolPair(entries: readonly Entry[], start: number): boolean {
	const calls = new Set<string>();
	for (let index = 0; index < start; index += 1) for (const id of callsIn(entries[index]!)) calls.add(id);
	if (calls.size === 0) return false;
	for (let index = start; index < entries.length; index += 1) for (const id of resultsIn(entries[index]!)) if (calls.has(id)) return true;
	return false;
}

export function retainTail(entries: readonly Entry[], retainTokens: number): number | null {
	if (entries.length < 2) return null;
	if (!(retainTokens > 0)) {
		const only = safeTailStart(entries, entries.length - 1);
		return only > 0 ? only - 1 : null;
	}
	const priced = entries.map(priceEntry);
	let retained = 0;
	let start = entries.length - 1;
	for (let index = entries.length - 1; index >= 1; index -= 1) {
		retained += priced[index]!;
		start = index;
		if (retained >= retainTokens) break;
	}
	const tail = safeTailStart(entries, start);
	return tail > 0 ? tail - 1 : null;
}
