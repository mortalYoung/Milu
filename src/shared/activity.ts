import type { PartnerActivityDay } from "./rpc";

const DAY_MS = 86_400_000;
const MAX_WEEKS = 104;

export function midnight(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function monday(ts: number): number {
	const d = new Date(midnight(ts));
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d.getTime();
}

export function activityWindow(weeks: number, now = Date.now()): PartnerActivityDay[] {
	const today = midnight(now);
	const start = monday(today) - (Math.max(1, Math.min(weeks, MAX_WEEKS)) - 1) * 7 * DAY_MS;
	const cursor = new Date(start);
	const days: PartnerActivityDay[] = [];
	while (cursor.getTime() <= today) {
		days.push({ ts: cursor.getTime(), tokens: 0, freshTokens: 0, turns: 0, tools: 0 });
		cursor.setDate(cursor.getDate() + 1);
	}
	return days;
}
