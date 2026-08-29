/**
 * Surface-priced context composition (4 chars ≈ 1 token).
 *
 * Unlike estimateBreakdown (which scans raw log entries), this prices exactly the
 * model-visible projection: user / assistant text / send_message / tool_result
 * nodes on the surface. Tool results are model-visible in the pi double loop, so
 * they count here — a deliberate improvement over the raw-entry heuristic.
 * Still heuristic (CJK/code undercounted), still labeled `~` in the UI.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import type { RequestTool } from "../../shared/rpc";
import type { Surface } from "../../shared/surface";
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

function priceNode(entry: Entry): number {
	if (entry.type === "message") {
		const m = entry.message;
		if (m.role === "user") return priceContent(m.content) + ROLE_OVERHEAD;
		if (m.role === "assistant") return priceContent(m.content) + ROLE_OVERHEAD;
		if (m.role === "toolResult") return priceContent(m.content) + ROLE_OVERHEAD;
		return ROLE_OVERHEAD;
	}
	if (entry.type === "custom" && (entry.customType === "send_message" || entry.customType === "compaction_summary")) {
		const data = (entry.data ?? {}) as { text?: unknown };
		return (typeof data.text === "string" ? tokens(data.text.length) + BLOCK_OVERHEAD : 0) + ROLE_OVERHEAD;
	}
	if (entry.type === "custom" && entry.customType === "tool/result") {
		const data = (entry.data ?? {}) as { content?: unknown };
		return priceContent(data.content) + ROLE_OVERHEAD;
	}
	return ROLE_OVERHEAD;
}

/**
 * Price the model-visible surface: system + tool definitions + surface-node messages.
 * Tools are not rendered into the prompt text anymore, but they ARE sent to the provider
 * via the tools parameter — so their serialized schema is priced as its own segment.
 */
export function priceSurface(systemPrompt: string, tools: RequestTool[], entries: Entry[], surface: Surface): ContextBreakdown {
	const byId = new Map<string, Entry>();
	for (const e of entries) byId.set(e.id, e);
	let messageTokens = 0;
	for (const node of surface.nodes) {
		const entry = byId.get(node.id);
		if (entry) messageTokens += priceNode(entry);
	}
	let toolsChars = 0;
	try {
		toolsChars = JSON.stringify(tools).length;
	} catch {
		// non-serializable schema → fall back to 0 rather than breaking the meter
	}
	return {
		systemTokens: tokens(systemPrompt.length) + ROLE_OVERHEAD,
		toolsTokens: tools.length === 0 ? 0 : tokens(toolsChars) + BLOCK_OVERHEAD,
		messageTokens,
	};
}
