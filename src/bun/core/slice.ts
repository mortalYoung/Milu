import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { EVENT_META, entryKey, projectSlice } from "../../shared/entry-meta";

interface ReconcileOptions {
	keepDangling?: boolean;
}

function reconcileOrigin(entries: Entry[], options: ReconcileOptions = {}): Entry[] {
	const out: Entry[] = [];
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		const meta = EVENT_META[entryKey(e)];
		if (meta?.reconcile?.visit) {
			meta.reconcile.visit({ entry: e, index: i, entries, out, keepDangling: options.keepDangling ?? false });
		} else {
			out.push(e);
		}
	}
	return out;
}

export function foldSlice(entries: Entry[], options: ReconcileOptions = {}): AgentMessage[] {
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
