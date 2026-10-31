import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FollowUpItem } from "@milu/protocol";

export function followUpId(message: AgentMessage): string | null {
	const id = (message as { dockId?: unknown }).dockId;
	return typeof id === "string" ? id : null;
}

export function followUpView(message: AgentMessage): FollowUpItem {
	const meta = message as unknown as { content?: unknown; scheduleId?: unknown; from?: unknown; skill?: unknown; timestamp?: unknown };
	const source = typeof meta.from === "string" ? "peer" : typeof meta.scheduleId === "string" ? "scheduled" : typeof meta.skill === "string" ? "skill" : "you";
	return {
		id: followUpId(message) ?? "",
		text: typeof meta.content === "string" ? meta.content : "",
		at: typeof meta.timestamp === "number" ? meta.timestamp : Date.now(),
		source,
	};
}
