/**
 * Heuristic context composition estimate (4 chars ≈ 1 token).
 *
 * Deliberately never reconciled with provider-exact usage: the fixed heuristic
 * systematically underestimates CJK text and code, and the provider number lags
 * one request and includes overhead the estimator does not model. Every number
 * the UI shows from here is labeled `~` (see ContextMeter). Improving accuracy
 * (e.g. CJK-weighted chars) touches only this file.
 */
import type { Entry } from "@earendil-works/pi-agent-core";

export interface ContextBreakdown {
	systemTokens: number;
	toolsTokens: number;
	messageTokens: number;
}

const CHARS_PER_TOKEN = 4;
const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/** Text of one pi entry's conversation contribution (user text, assistant text, send_message). */
function entryText(entry: Entry): string {
	if (entry.type === "custom") {
		// Custom entries: only send_message contributes visible conversation text.
		if (entry.customType === "send_message") {
			const data = (entry.data ?? {}) as { text?: unknown };
			return typeof data.text === "string" ? data.text : "";
		}
		return "";
	}
	if (entry.type !== "message") return "";
	const msg = entry.message;
	if (msg.role === "user") {
		return typeof msg.content === "string" ? msg.content : contentText(msg.content);
	}
	if (msg.role === "assistant") {
		const blocks = (msg.content as { type?: unknown; text?: unknown }[]) ?? [];
		return blocks
			.filter((b) => b.type === "text")
			.map((b) => String(b.text ?? ""))
			.join("\n");
	}
	return "";
}

/** Content block array → text (strings pass through unchanged; non-text blocks are skipped). */
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as { type?: unknown; text?: unknown } | null;
			if (!block) return "";
			if (block.type === "text") return String(block.text ?? "");
			return "";
		})
		.join("\n");
}

/**
 * Heuristic breakdown of the current context into system / tools / messages.
 * The system prompt is static (one per Partner), so callers may cache it per partner.
 * Tools are not rendered in the prompt anymore, so nothing is priced for them.
 */
export function estimateBreakdown(systemPrompt: string, entries: Entry[]): ContextBreakdown {
	let messageChars = 0;
	for (const entry of entries) messageChars += entryText(entry).length;
	return {
		systemTokens: tokens(systemPrompt.length),
		toolsTokens: 0,
		messageTokens: tokens(messageChars),
	};
}
