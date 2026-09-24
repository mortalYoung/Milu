import { open, stat } from "node:fs/promises";
import type { DashboardMemorySizes, DashboardOverview, DashboardPartnerStats, DashboardRun, DashboardTotals, PartnerActivityDay } from "../../shared/rpc";
import { getPartnerDir, loadSettings } from "../lib/settings";
import { listPartners } from "../partners";
import type { SessionStore } from "../persist";
import { dailyActivity } from "./activity";
import { type MemoryRunRecord, memoryFilePath, memoryRunsFilePath } from "./memory";
import { personaFilePath } from "./persona";
import { loadRuntimeStats } from "./runtime-stats";
import { scenesFilePath } from "./scenes";

export const DASHBOARD_WINDOW_DAYS = 7;
export const DASHBOARD_WINDOW_MAX_DAYS = 120;
export const DASHBOARD_HEATMAP_WEEKS = 53;
const ACTIVITY_WEEKS = 104;
const DAY_MS = 86_400_000;
const RUN_TAIL_STEPS = [64 * 1024, 512 * 1024, 4 * 1024 * 1024];

type SessionReader = Pick<SessionStore, "allRawEntries">;

async function fileBytes(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

async function tailLines(path: string, bytes: number): Promise<{ lines: string[]; truncated: boolean }> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "r");
	} catch {
		return { lines: [], truncated: false };
	}
	try {
		const { size } = await handle.stat();
		const start = Math.max(0, size - bytes);
		if (start >= size) return { lines: [], truncated: false };
		const buffer = Buffer.alloc(size - start);
		await handle.read(buffer, 0, buffer.length, start);
		return { lines: buffer.toString("utf8").split("\n"), truncated: start > 0 };
	} catch {
		return { lines: [], truncated: false };
	} finally {
		await handle.close();
	}
}

function parseRun(line: string): Omit<DashboardRun, "partner"> | null {
	try {
		const parsed = JSON.parse(line) as Partial<MemoryRunRecord>;
		if (typeof parsed.runId !== "string" || typeof parsed.stage !== "string" || typeof parsed.reason !== "string" || typeof parsed.startedAt !== "number") return null;
		return {
			stage: parsed.stage,
			reason: parsed.reason,
			added: typeof parsed.added === "number" ? parsed.added : 0,
			startedAt: parsed.startedAt,
			durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 0,
		};
	} catch {
		return null;
	}
}

async function runsSince(dir: string, since: number): Promise<Omit<DashboardRun, "partner">[]> {
	const path = memoryRunsFilePath(dir);
	const found: Omit<DashboardRun, "partner">[] = [];
	for (const bytes of RUN_TAIL_STEPS) {
		const { lines, truncated } = await tailLines(path, bytes);
		found.length = 0;
		let reachedHead = !truncated;
		for (let i = lines.length - 1; i >= (truncated ? 1 : 0); i--) {
			const run = parseRun(lines[i] ?? "");
			if (!run) continue;
			if (run.startedAt < since) {
				reachedHead = true;
				break;
			}
			found.push(run);
		}
		if (reachedHead) break;
	}
	return found;
}

async function memorySizes(dir: string): Promise<DashboardMemorySizes> {
	const [memories, scenes, persona, runs] = await Promise.all([
		fileBytes(memoryFilePath(dir)),
		fileBytes(scenesFilePath(dir)),
		fileBytes(personaFilePath(dir)),
		fileBytes(memoryRunsFilePath(dir)),
	]);
	return { memories, scenes, persona, runs, total: memories + scenes + persona + runs };
}

function quantile(sorted: number[], q: number): number | null {
	if (sorted.length === 0) return null;
	const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
	return sorted[at] ?? null;
}

function midnight(ts: number): number {
	const date = new Date(ts);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function mondayOf(ts: number): number {
	const date = new Date(midnight(ts));
	date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
	return date.getTime();
}

const EMPTY_DAY = (ts: number): PartnerActivityDay => ({ ts, tokens: 0, freshTokens: 0, turns: 0, tools: 0 });

const sum = (xs: number[]) => xs.reduce((total, x) => total + x, 0);

export async function buildDashboardOverview(session: SessionReader, requestedDays?: number): Promise<DashboardOverview> {
	const windowDays = Math.min(DASHBOARD_WINDOW_MAX_DAYS, Math.max(DASHBOARD_WINDOW_DAYS, Math.round(requestedDays ?? DASHBOARD_WINDOW_DAYS)));
	const settings = await loadSettings();
	const profiles = await listPartners(settings);
	const partners: DashboardPartnerStats[] = [];
	const runs: DashboardRun[] = [];
	const dayStart = midnight(Date.now());
	const ttfts: number[] = [];
	const merged = new Map<number, PartnerActivityDay>();
	const memory: DashboardMemorySizes = { memories: 0, scenes: 0, persona: 0, runs: 0, total: 0 };
	let turns = 0;
	let freshTokens = 0;
	let totalTokens = 0;
	let outputTokens = 0;
	let tools = 0;
	let durationMs = 0;

	for (const profile of profiles) {
		const dir = getPartnerDir(settings, profile.name);
		const activity = dailyActivity(await session.allRawEntries(dir), ACTIVITY_WEEKS);
		let partnerTurns = 0;
		let partnerFresh = 0;
		let partnerTotal = 0;
		let partnerTools = 0;
		for (const day of activity) {
			partnerTurns += day.turns;
			partnerFresh += day.freshTokens;
			partnerTotal += day.tokens;
			partnerTools += day.tools;
			if (day.turns === 0) continue;
			const bucket = merged.get(day.ts) ?? EMPTY_DAY(day.ts);
			bucket.turns += day.turns;
			bucket.freshTokens += day.freshTokens;
			bucket.tokens += day.tokens;
			bucket.tools += day.tools;
			merged.set(day.ts, bucket);
		}

		const [runtime, sizes, todayRuns] = await Promise.all([loadRuntimeStats(dir), memorySizes(dir), runsSince(dir, dayStart)]);
		for (const run of todayRuns) runs.push({ partner: profile.name, ...run });
		const output = sum(runtime.speedOutputs);
		const generationMs = sum(runtime.speedDurationsMs);
		const samples = [...runtime.ttfts].sort((a, b) => a - b);
		partners.push({
			name: profile.name,
			turns: partnerTurns,
			freshTokens: partnerFresh,
			totalTokens: partnerTotal,
			tools: partnerTools,
			ttftMedianMs: quantile(samples, 0.5),
			lastTtftMs: runtime.lastTtft,
			ttftSamples: samples.length,
			tps: generationMs > 0 ? output / (generationMs / 1000) : null,
			memory: sizes,
			days: activity.slice(-windowDays).map((day) => day.turns),
		});

		turns += partnerTurns;
		freshTokens += partnerFresh;
		totalTokens += partnerTotal;
		outputTokens += output;
		tools += partnerTools;
		durationMs += generationMs;
		ttfts.push(...runtime.ttfts);
		memory.memories += sizes.memories;
		memory.scenes += sizes.scenes;
		memory.persona += sizes.persona;
		memory.runs += sizes.runs;
		memory.total += sizes.total;
	}

	const recorded = [...merged.keys()].sort((a, b) => a - b);
	const today = midnight(Date.now());
	const start = mondayOf(today) - (DASHBOARD_HEATMAP_WEEKS - 1) * 7 * DAY_MS;
	const heatmap: PartnerActivityDay[] = [];
	for (const cursor = new Date(start); cursor.getTime() <= today; cursor.setDate(cursor.getDate() + 1)) {
		const ts = cursor.getTime();
		heatmap.push(merged.get(ts) ?? EMPTY_DAY(ts));
	}
	const days = heatmap.slice(-windowDays);

	ttfts.sort((a, b) => a - b);
	const totals: DashboardTotals = {
		letters: profiles.length,
		turns,
		freshTokens,
		cacheTokens: Math.max(0, totalTokens - freshTokens),
		totalTokens,
		tools,
		ttftMedianMs: quantile(ttfts, 0.5),
		ttftP90Ms: quantile(ttfts, 0.9),
		ttftSamples: ttfts.length,
		tps: durationMs > 0 ? outputTokens / (durationMs / 1000) : null,
		memory,
		since: recorded[0] ?? null,
	};
	runs.sort((a, b) => b.startedAt - a.startedAt);
	return { partners, totals, days, runs, windowDays, activityWeeks: ACTIVITY_WEEKS, heatmap };
}
