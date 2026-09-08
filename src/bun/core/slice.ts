import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { projectSlice } from "../../shared/entry-meta";
import type { CompactionEventData, RewindEventData } from "../../shared/events";
import { EVENTS } from "../persist/events";

interface ReconcileOptions {
	keepDangling?: boolean;
}

interface FoldSliceOptions extends ReconcileOptions {}

function dropDanglingEntries(entries: Entry[]): Entry[] {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type !== "message" || e.message.role !== "assistant") continue;
		const blocks = Array.isArray(e.message.content) ? e.message.content : [];
		const toolCalls = blocks.filter((b) => (b as { type?: unknown }).type === "toolCall");
		if (toolCalls.length === 0) break;
		const next = entries[i + 1];
		const firstId = (toolCalls[0] as { id?: unknown }).id;
		const complete = next != null && next.type === "custom" && next.customType === EVENTS.toolResult && (next.data as { toolCallId?: unknown }).toolCallId === firstId;
		if (complete) break;
		entries.splice(i);
		break;
	}
	return entries;
}

function pairToolResultEntries(entries: Entry[]): Entry[] {
	const out: Entry[] = [];
	for (const e of entries) {
		if (e.type !== "custom" || e.customType !== EVENTS.toolResult) {
			out.push(e);
			continue;
		}
		const callId = (e.data as { toolCallId?: unknown }).toolCallId;
		let owner = -1;
		for (let i = out.length - 1; i >= 0; i--) {
			const prev = out[i];
			if (prev.type !== "message" || prev.message.role !== "assistant") continue;
			const blocks = Array.isArray(prev.message.content) ? prev.message.content : [];
			const ids = blocks.filter((b) => (b as { type?: unknown }).type === "toolCall").map((b) => (b as { id?: unknown }).id);
			if (ids.includes(callId)) {
				owner = i;
				break;
			}
		}
		if (owner < 0) {
			out.push(e);
			continue;
		}
		let k = owner;
		while (k + 1 < out.length) {
			const next = out[k + 1];
			if (next.type !== "custom" || next.customType !== EVENTS.toolResult) break;
			k++;
		}
		out.splice(k + 1, 0, e);
	}
	return out;
}

function reconcileOrigin(entries: Entry[], options: ReconcileOptions = {}): Entry[] {
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
	const out: Entry[] = [];
	if (latestCompaction && throughIndex >= 0) {
		out.push({
			type: "custom",
			customType: EVENTS.compactionSummary,
			id: `__compaction__${latestCompaction.through}`,
			data: { text: latestCompaction.summary, timestamp: latestCompaction.time },
			timestamp: latestCompaction.time,
		} as unknown as Entry);
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
				out.push({ ...(e as object), message: { ...e.message, content: rewind.text } } as Entry);
				continue;
			}
		}
		out.push(e);
	}
	if (!options.keepDangling) dropDanglingEntries(out);
	return pairToolResultEntries(out);
}

export function foldSlice(entries: Entry[], options: FoldSliceOptions = {}): AgentMessage[] {
	return projectSlice(reconcileOrigin(entries, options));
}

export function buildResumeTurn(entries: Entry[], toolCallId: string): { messages: AgentMessage[]; insertAt: number } | null {
	const messages = foldSlice(entries, { keepDangling: true });
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
