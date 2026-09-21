/**
 * Server-side trajectory metrics + compatibility re-export of the shared Timeline.
 *
 * Concept naming: Entry → Data (buildData) lives in shared/timeline.ts so
 * both server and renderer use one implementation; this module keeps the server-only usage
 * aggregators (aggregateUsage / lastUsage / lastTrajectoryUsage) and re-exports the shared API.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import type { TrajectoryUsage, UsageTotals } from "../../shared/rpc";
import { buildData, toTrajectoryUsage, toUsage, type Usage } from "../../shared/timeline";

export type { Usage };
export { buildData, toTrajectoryUsage, toUsage };

export function aggregateUsage(entries: Entry[]): UsageTotals | null {
	let totals: UsageTotals | null = null;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage) continue;
		const u = toUsage(msg.usage);
		totals ??= { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		totals.messages += 1;
		totals.input += u.input;
		totals.output += u.output;
		totals.cacheRead += u.cacheRead;
		totals.cacheWrite += u.cacheWrite;
	}
	return totals;
}

/** An aborted turn still writes an assistant message, but its usage comes back empty — that is not a
 * sample of the context, so it must not displace the last real one. */
const hasUsageSample = (usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }) =>
	(usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) > 0;

export function lastUsage(entries: Entry[]): Usage | null {
	let last: Usage | null = null;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage || !hasUsageSample(msg.usage)) continue;
		last = toUsage(msg.usage);
	}
	return last;
}

export function lastTrajectoryUsage(entries: Entry[]): TrajectoryUsage | null {
	let last: TrajectoryUsage | null = null;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "assistant" || !msg.usage || !hasUsageSample(msg.usage)) continue;
		const u = toTrajectoryUsage(msg.usage);
		if (u) last = u;
	}
	return last;
}
