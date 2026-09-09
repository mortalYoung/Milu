import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { foldSlice } from "../../shared/slice";

export { type FoldSliceOptions, foldSlice, foldSliceItems } from "../../shared/slice";

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
