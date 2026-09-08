import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { RequestTool } from "../../shared/rpc";
import type { ContextBreakdown } from "./context-estimate";

const CHARS_PER_TOKEN = 4;
const ROLE_OVERHEAD = 4;
const BLOCK_OVERHEAD = 4;
const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

function stringLength(value: unknown): number {
	if (typeof value === "string") return value.length;
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

function priceContent(content: unknown): number {
	if (typeof content === "string") return tokens(content.length) + BLOCK_OVERHEAD;
	if (!Array.isArray(content)) return 0;
	let total = 0;
	for (const raw of content) {
		const block = raw as { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; arguments?: unknown; content?: unknown } | null;
		if (!block) continue;
		switch (block.type) {
			case "text":
				total += tokens(stringLength(block.text)) + BLOCK_OVERHEAD;
				break;
			case "thinking":
				total += tokens(stringLength(block.thinking)) + BLOCK_OVERHEAD;
				break;
			case "toolCall":
				total += tokens(stringLength(block.name)) + tokens(stringLength(block.arguments)) + BLOCK_OVERHEAD;
				break;
			case "toolResult":
				total += priceContent(block.content) + BLOCK_OVERHEAD;
				break;
			default:
				total += BLOCK_OVERHEAD + tokens(stringLength(raw));
				break;
		}
	}
	return total;
}

function priceMessage(m: AgentMessage): number {
	if (m.role === "user") return priceContent(m.content) + ROLE_OVERHEAD;
	if (m.role === "assistant") return priceContent(m.content) + ROLE_OVERHEAD;
	if (m.role === "toolResult") return priceContent((m as unknown as { content?: unknown }).content) + ROLE_OVERHEAD;
	if (m.role === "custom") return priceContent((m as unknown as { content?: unknown }).content) + ROLE_OVERHEAD;
	return ROLE_OVERHEAD;
}

/**
 * Price the model-visible slice: system + tool definitions + the actual AgentMessage[].
 * Tools are sent to the provider via the tools parameter, so their serialized schema is
 * priced as its own segment. Still heuristic (CJK/code undercounted), labeled `~` in the UI.
 */
export function priceMessages(systemPrompt: string, tools: RequestTool[], messages: AgentMessage[]): ContextBreakdown {
	let toolsChars = 0;
	try {
		toolsChars = JSON.stringify(tools).length;
	} catch {
		// non-serializable schema → fall back to 0 rather than breaking the meter
	}
	let messageTokens = 0;
	for (const m of messages) messageTokens += priceMessage(m);
	return {
		systemTokens: tokens(systemPrompt.length) + ROLE_OVERHEAD,
		toolsTokens: tools.length === 0 ? 0 : tokens(toolsChars) + BLOCK_OVERHEAD,
		messageTokens,
	};
}
