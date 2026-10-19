import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface ContextBreakdown {
	systemTokens: number;
	toolsTokens: number;
	messageTokens: number;
}

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

function priceMessage(message: AgentMessage): number {
	if (message.role === "user") return priceContent(message.content) + ROLE_OVERHEAD;
	if (message.role === "assistant") return priceContent(message.content) + ROLE_OVERHEAD;
	const content = (message as unknown as { content?: unknown }).content;
	return priceContent(content) + ROLE_OVERHEAD;
}

export function priceMessages(systemPrompt: string, tools: readonly unknown[], messages: readonly AgentMessage[]): ContextBreakdown {
	let toolsChars = 0;
	try {
		toolsChars = JSON.stringify(tools).length;
	} catch {
		toolsChars = 0;
	}
	let messageTokens = 0;
	for (const message of messages) messageTokens += priceMessage(message);
	return {
		systemTokens: tokens(systemPrompt.length) + ROLE_OVERHEAD,
		toolsTokens: tools.length === 0 ? 0 : tokens(toolsChars) + BLOCK_OVERHEAD,
		messageTokens,
	};
}

export function totalTokens(breakdown: ContextBreakdown): number {
	return breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
}
