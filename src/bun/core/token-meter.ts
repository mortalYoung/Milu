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
import type { Surface } from "../../shared/surface";
import type { ContextBreakdown } from "./context-estimate";

const CHARS_PER_TOKEN = 4;
const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/** Text of one surface node's model-visible contribution ("" for log-only entries). */
function nodeText(entry: Entry): string {
	if (entry.type === "message") {
		const m = entry.message;
		if (m.role === "user") return typeof m.content === "string" ? m.content : contentText(m.content);
		if (m.role === "assistant") return textBlocks(m.content);
		if (m.role === "toolResult") return contentText(m.content);
		return "";
	}
	if (entry.type === "custom" && (entry.customType === "send_message" || entry.customType === "compaction_summary")) {
		const data = (entry.data ?? {}) as { text?: unknown };
		return typeof data.text === "string" ? data.text : "";
	}
	// Tool results are model-visible surface nodes; the log keeps them as tool/result events (see persist/events.ts)
	if (entry.type === "custom" && entry.customType === "tool/result") {
		const data = (entry.data ?? {}) as { content?: unknown };
		return contentText(data.content);
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

/** Assistant content blocks → text blocks only (thinking/tool calls never count as message tokens). */
function textBlocks(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((b) => (b as { type?: unknown }).type === "text")
		.map((b) => String((b as { text?: unknown }).text ?? ""))
		.join("\n");
}

/** Price the model-visible surface: system + tools + surface-node messages. */
export function priceSurface(systemPrompt: string, toolGuidance: Record<string, string>, entries: Entry[], surface: Surface): ContextBreakdown {
	const byId = new Map<string, Entry>();
	for (const e of entries) byId.set(e.id, e);
	let messageChars = 0;
	for (const node of surface.nodes) {
		const entry = byId.get(node.id);
		if (entry) messageChars += nodeText(entry).length;
	}
	const toolsText = Object.entries(toolGuidance)
		.map(([name, guidance]) => `${name}: ${guidance}`)
		.join("\n");
	return {
		systemTokens: tokens(systemPrompt.length),
		toolsTokens: tokens(toolsText.length),
		messageTokens: tokens(messageChars),
	};
}
