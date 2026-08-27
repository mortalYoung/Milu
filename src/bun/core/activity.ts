import type { Entry } from "@earendil-works/pi-agent-core";
import type { PartnerActivityDay } from "../../shared/rpc";

const DAY_MS = 86_400_000;

function midnight(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function monday(ts: number): number {
	const d = new Date(midnight(ts));
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d.getTime();
}

export function dailyActivity(entries: Entry[], weeks: number): PartnerActivityDay[] {
	const today = midnight(Date.now());
	const start = monday(today) - (Math.max(1, Math.min(weeks, 104)) - 1) * 7 * DAY_MS;
	const cursor = new Date(start);
	const days: PartnerActivityDay[] = [];
	const byDay = new Map<number, PartnerActivityDay>();
	while (cursor.getTime() <= today) {
		const day = { ts: cursor.getTime(), tokens: 0, turns: 0, tools: 0 };
		days.push(day);
		byDay.set(day.ts, day);
		cursor.setDate(cursor.getDate() + 1);
	}
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage) continue;
		const day = byDay.get(midnight(entry.timestamp));
		if (!day) continue;
		day.tokens += msg.usage.totalTokens ?? 0;
		day.turns += 1;
		if (Array.isArray(msg.content)) day.tools += msg.content.filter((b) => (b as { type?: unknown })?.type === "toolCall").length;
	}
	return days;
}
