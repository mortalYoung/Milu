import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { PendingItem, PendingKind } from "@milu/protocol";

export function pendingId(message: AgentMessage): string | null {
	const id = (message as { pendingId?: unknown }).pendingId;
	return typeof id === "string" ? id : null;
}

export function pendingView(message: AgentMessage, kind: PendingKind): PendingItem {
	const meta = message as unknown as { content?: unknown; scheduleId?: unknown; from?: unknown; skill?: unknown; timestamp?: unknown };
	const source = typeof meta.from === "string" ? "peer" : typeof meta.scheduleId === "string" ? "scheduled" : typeof meta.skill === "string" ? "skill" : "you";
	return {
		id: pendingId(message) ?? "",
		text: typeof meta.content === "string" ? meta.content : "",
		at: typeof meta.timestamp === "number" ? meta.timestamp : Date.now(),
		kind,
		source,
	};
}
