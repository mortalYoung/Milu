import type { Entry } from "@earendil-works/pi-agent-core";
import { activityWindow, midnight } from "../../shared/activity";
import type { PartnerActivityDay } from "../../shared/rpc";
import { toUsage } from "../../shared/timeline";

export function dailyActivity(entries: Entry[], weeks: number): PartnerActivityDay[] {
	const days = activityWindow(weeks);
	const byDay = new Map(days.map((day) => [day.ts, day]));
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage) continue;
		const day = byDay.get(midnight(entry.timestamp));
		if (!day) continue;
		const usage = toUsage(msg.usage);
		day.tokens += usage.totalTokens;
		day.freshTokens += usage.input + usage.output + usage.cacheWrite;
		day.turns += 1;
		if (Array.isArray(msg.content)) day.tools += msg.content.filter((b) => (b as { type?: unknown })?.type === "toolCall").length;
	}
	return days;
}
