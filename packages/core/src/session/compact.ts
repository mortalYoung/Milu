import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";

const MIN_ENTRIES = 8;
const QA_PAIRS = 5;
const QA_MAX_CHARS = 200;

const PREAMBLE = "Earlier messages were removed from the active context to keep the conversation within the model's window; they remain in the session log.";
const QA_HEADER = "Recent Q/A:";

export type CompactionTier = "full" | "shrunk" | "degraded";

export interface CompactionPlan {
	readonly summary: string;
	readonly throughEntryId: string;
	readonly shadowedIds: readonly string[];
	readonly shadowed: number;
	readonly tier: CompactionTier;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const text = block as { type?: unknown; text?: unknown };
		if (text.type === "text" && typeof text.text === "string") parts.push(text.text);
	}
	return parts.join(" ");
}

function oneLine(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > QA_MAX_CHARS ? `${line.slice(0, QA_MAX_CHARS)}…` : line;
}

function recentQa(messages: readonly AgentMessage[]): string {
	const pairs: { q: string; a: string }[] = [];
	let current: { q: string; a: string } | null = null;
	for (const message of messages) {
		if (message.role === "user") {
			if (current) pairs.push(current);
			current = { q: oneLine(messageText(message.content)), a: "" };
			continue;
		}
		if (current && message.role === "assistant") {
			const text = oneLine(messageText(message.content));
			if (text) current.a = text;
		}
	}
	if (current) pairs.push(current);
	return pairs
		.slice(-QA_PAIRS)
		.map(({ q, a }) => (a ? `- Q: ${q}\n  A: ${a}` : `- Q: ${q}`))
		.join("\n");
}

export function planCompaction(entries: readonly Entry[], messages: readonly AgentMessage[]): CompactionPlan | null {
	if (entries.length < MIN_ENTRIES) return null;
	const parts = [PREAMBLE];
	const qa = recentQa(messages);
	if (qa) parts.push(QA_HEADER, qa);
	return {
		summary: parts.join("\n"),
		throughEntryId: entries[entries.length - 1]!.id,
		shadowedIds: entries.map((entry) => entry.id),
		shadowed: entries.length,
		tier: "degraded",
	};
}
