import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { EVENT_META, entryKey } from "../../shared/entry-meta";
import type { CompactionEventData, RewindEventData } from "../../shared/events";
import type { RequestTool } from "../../shared/rpc";
import { EVENTS } from "../persist/events";

export function deriveEventMessage(entry: Entry): AgentMessage | null {
	const out: AgentMessage[] = [];
	EVENT_META[entryKey(entry)]?.slice?.visit?.(entry, out);
	return out[0] ?? null;
}

/** Collect the model-visible slice from origin entries, handling compaction and rewind markers. */
export function projectChain(entries: Entry[]): AgentMessage[] {
	let latestCompaction: { through: string; summary: string; time: number } | null = null;
	const rewinds = new Map<string, { text: string; shadowedIds: string[] }>();
	for (const e of entries) {
		if (e.type !== "custom") continue;
		if (e.customType === EVENTS.compaction) {
			const d = (e.data ?? {}) as CompactionEventData;
			latestCompaction = { through: d.throughEntryId, summary: d.summary, time: d.timestamp ?? e.timestamp ?? 0 };
		} else if (e.customType === EVENTS.rewind) {
			const d = (e.data ?? {}) as RewindEventData;
			rewinds.set(d.targetId, { text: d.text, shadowedIds: d.shadowedIds });
		}
	}

	const shadowed = new Set<string>();
	for (const r of rewinds.values()) for (const id of r.shadowedIds) shadowed.add(id);

	const throughIndex = latestCompaction ? entries.findIndex((e) => e.id === latestCompaction.through) : -1;
	const out: AgentMessage[] = [];
	if (latestCompaction && throughIndex >= 0) {
		out.push({ role: "user", content: latestCompaction.summary, timestamp: latestCompaction.time } as AgentMessage);
	}
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (latestCompaction && i <= throughIndex) continue;
		if (
			e.type === "custom" &&
			(e.customType === EVENTS.compaction ||
				e.customType === EVENTS.rewind ||
				e.customType === EVENTS.compactionSummary ||
				e.customType === EVENTS.compactionStart ||
				e.customType === EVENTS.compactionEnd ||
				e.customType === EVENTS.compactionPrune)
		) {
			continue;
		}
		if (shadowed.has(e.id)) continue;
		if (e.type === "message" && e.message.role === "user") {
			const rewind = rewinds.get(e.id);
			if (rewind) {
				out.push({ ...(e.message as object), content: rewind.text } as AgentMessage);
				continue;
			}
		}
		const msg = deriveEventMessage(e);
		if (msg) out.push(msg);
	}
	return pairToolResults(out);
}

/** Fold origin entries directly into the model-visible slice (AgentMessage[]). */
export function foldSlice(entries: Entry[]): AgentMessage[] {
	return dropDanglingTurn(projectChain(entries));
}

export function deriveMessages(entries: Entry[]): AgentMessage[] {
	return foldSlice(entries);
}

export function pairToolResults(messages: AgentMessage[]): AgentMessage[] {
	const out: AgentMessage[] = [];
	for (const m of messages) {
		if (m.role !== "toolResult") {
			out.push(m);
			continue;
		}
		let owner = -1;
		for (let i = out.length - 1; i >= 0; i--) {
			const prev = out[i];
			if (prev.role !== "assistant") continue;
			const blocks = Array.isArray(prev.content) ? prev.content : [];
			const ids = blocks.filter((b) => b.type === "toolCall").map((b) => (b as { id: string }).id);
			if (ids.includes((m as ToolResultMessage).toolCallId)) {
				owner = i;
				break;
			}
		}
		if (owner < 0) {
			out.push(m);
			continue;
		}
		let k = owner;
		while (k + 1 < out.length && out[k + 1].role === "toolResult") k++;
		out.splice(k + 1, 0, m);
	}
	return out;
}

export function buildResumeTurn(entries: Entry[], toolCallId: string): { messages: AgentMessage[]; insertAt: number } | null {
	const messages = projectChain(entries);
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const blocks = m.content as { type: string; id: string }[];
		if (!blocks.some((b) => b.type === "toolCall" && b.id === toolCallId)) continue;
		if (messages.slice(i + 1).some((m2) => m2.role === "assistant" || m2.role === "toolResult")) return null;
		return { messages, insertAt: i + 1 };
	}
	return null;
}

export function dropDanglingTurn(messages: AgentMessage[]): AgentMessage[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const blocks = m.content as { type: string; id: string }[];
		const hasToolCalls = blocks.some((b) => b.type === "toolCall");
		if (!hasToolCalls) break;
		const next = messages[i + 1];
		const complete = next != null && next.role === "toolResult" && (next as ToolResultMessage).toolCallId === blocks.find((b) => b.type === "toolCall")?.id;
		if (complete) break;
		messages.splice(i);
		break;
	}
	return messages;
}

export function reconstructRequestHeader(entries: Entry[]): { systemPrompt: string; tools: RequestTool[]; toolNames: string[]; time: number } | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== EVENTS.requestHeader) continue;
		const data = (entry.data ?? {}) as { systemPrompt?: unknown; tools?: unknown; toolNames?: unknown; timestamp?: unknown };
		const tools = Array.isArray(data.tools) ? data.tools.filter((t): t is RequestTool => !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string") : [];
		const toolNames = tools.length > 0 ? tools.map((t) => t.name) : Array.isArray(data.toolNames) ? data.toolNames.filter((n): n is string => typeof n === "string") : [];
		return {
			systemPrompt: typeof data.systemPrompt === "string" ? data.systemPrompt : "",
			tools,
			toolNames,
			time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		};
	}
	return null;
}
