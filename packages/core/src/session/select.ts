import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Entry } from "@milu/protocol";

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
	if (entry.type !== "message" || entry.message.role !== "toolResult") return [];
	const callId = (entry.message as { toolCallId?: unknown }).toolCallId;
	return typeof callId === "string" ? [callId] : [];
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
	if (!(retainTokens > 0)) return entries.length - 1;
	const priced = entries.map(priceEntry);
	let retained = 0;
	let start = entries.length - 1;
	for (let index = entries.length - 1; index >= 1; index -= 1) {
		retained += priced[index]!;
		start = index;
		if (retained >= retainTokens) break;
	}
	while (start > 0 && splitsToolPair(entries, start)) start -= 1;
	return start > 0 ? start - 1 : null;
}
