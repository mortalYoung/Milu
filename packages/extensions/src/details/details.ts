import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import { type Entry, type Extension, type ModelsService, type Session, type SettingsService } from "@milu/core";

import { McpServiceId } from "../mcp/mcp.ts";
import type { McpServerStatus } from "../mcp/types.ts";
import { buildMemoryOverview, type MemoryOverview } from "../memory/overview.ts";
import { RuntimeStatsServiceId, type RuntimeSummary } from "../runtime/runtime.ts";
import { ScheduleServiceId } from "../schedule/schedule.ts";
import type { RunRecord, ScheduleDefinition } from "../schedule/store.ts";
import type { SkillSummary } from "../skills/catalog.ts";
import { SkillsServiceId } from "../skills/service.ts";

export const HEATMAP_WEEKS = 53;

const DAY_MS = 86_400_000;
const ACTIVITY_MAX_WEEKS = 104;

export interface ActivityDay {
	readonly ts: number;
	tokens: number;
	freshTokens: number;
	turns: number;
	tools: number;
}

export interface SessionTokenUsage {
	messages: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface SessionSize {
	readonly bytes: number;
	readonly parts: readonly { readonly label: string; readonly bytes: number }[];
}

export interface SessionSummary {
	readonly name: string;
	readonly path: string;
	readonly storage: string;
	readonly createdAt: number;
	readonly persona?: string;
	readonly forkedFrom?: string;
	readonly pinned?: boolean;
	readonly running: boolean;
	readonly workspace?: { readonly path: string | null; readonly kind?: string | null; readonly repo?: string | null };
}

export interface ModelChoiceGroup {
	readonly provider: string;
	readonly models: readonly { readonly id: string; readonly name: string }[];
}

export interface SessionDetails extends SessionSummary {
	readonly activity: readonly ActivityDay[];
	readonly usage: SessionTokenUsage | null;
	readonly cacheShare: number | null;
	readonly context: { readonly used: number; readonly window: number; readonly percent: number } | null;
	readonly size: SessionSize;
	readonly model: { readonly provider: string; readonly modelId?: string } | null;
	readonly models: readonly ModelChoiceGroup[];
	readonly efforts: readonly string[];
	readonly effort: string;
	readonly sandbox: string;
	readonly skills: readonly { readonly name: string; readonly scope: string }[];
	readonly mcp: readonly McpServerStatus[];
	readonly memory: MemoryOverview | null;
	readonly schedules: { readonly schedules: readonly ScheduleDefinition[]; readonly runs: readonly RunRecord[] } | null;
	readonly runtime: RuntimeSummary | null;
}

export interface DetailsSources {
	readonly models: ModelsService | null;
	readonly schedule: { snapshot(session: Session): Promise<{ schedules: readonly ScheduleDefinition[]; runs: readonly RunRecord[] }> } | null;
	readonly skills: { list(session: Session): Promise<readonly SkillSummary[]> } | null;
	readonly mcp: { statuses(session: Session): Promise<readonly McpServerStatus[]> } | null;
	readonly runtime: { summary(session: Session): Promise<RuntimeSummary> } | null;
	readonly settings: SettingsService;
}

function midnight(ts: number): number {
	const date = new Date(ts);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function monday(ts: number): number {
	const date = new Date(midnight(ts));
	date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
	return date.getTime();
}

function activityWindow(weeks: number, now = Date.now()): ActivityDay[] {
	const today = midnight(now);
	const start = monday(today) - (Math.max(1, Math.min(weeks, ACTIVITY_MAX_WEEKS)) - 1) * 7 * DAY_MS;
	const days: ActivityDay[] = [];
	for (const cursor = new Date(start); cursor.getTime() <= today; cursor.setDate(cursor.getDate() + 1)) {
		days.push({ ts: cursor.getTime(), tokens: 0, freshTokens: 0, turns: 0, tools: 0 });
	}
	return days;
}

function dailyActivity(entries: readonly Entry[], weeks: number): ActivityDay[] {
	const days = activityWindow(weeks);
	const byDay = new Map(days.map((day) => [day.ts, day]));
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "assistant" || !message.usage) continue;
		const day = byDay.get(midnight(entry.timestamp));
		if (!day) continue;
		const usage = message.usage;
		day.tokens += usage.totalTokens;
		day.freshTokens += usage.input + usage.output + usage.cacheWrite;
		day.turns += 1;
		if (Array.isArray(message.content)) day.tools += message.content.filter((block) => (block as { type?: unknown } | null)?.type === "toolCall").length;
	}
	return days;
}

function aggregateUsage(entries: readonly Entry[]): SessionTokenUsage | null {
	let totals: SessionTokenUsage | null = null;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "assistant" || !message.usage) continue;
		totals ??= { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		totals.messages += 1;
		totals.input += message.usage.input;
		totals.output += message.usage.output;
		totals.cacheRead += message.usage.cacheRead;
		totals.cacheWrite += message.usage.cacheWrite;
	}
	return totals;
}

async function sizeOf(path: string): Promise<number> {
	const info = await lstat(path).catch(() => null);
	if (!info) return 0;
	if (!info.isDirectory()) return info.size;
	const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
	let total = 0;
	for (const entry of entries) total += await sizeOf(join(path, entry.name));
	return total;
}

async function partLabel(path: string, name: string, isDirectory: boolean): Promise<string> {
	if (!isDirectory) return "config";
	if (name === ".memory") return "memory";
	if (name === "storage") return "storage";
	if (name === "schedules") return "schedules";
	const entries = await readdir(path).catch(() => []);
	return entries.some((file) => file.endsWith(".jsonl")) ? "sessions" : name;
}

async function sessionSize(dir: string): Promise<SessionSize> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const parts = new Map<string, number>();
	let bytes = 0;
	for (const entry of entries) {
		const path = join(dir, entry.name);
		const size = await sizeOf(path);
		bytes += size;
		const label = await partLabel(path, entry.name, entry.isDirectory());
		parts.set(label, (parts.get(label) ?? 0) + size);
	}
	return {
		bytes,
		parts: [...parts].map(([label, partBytes]) => ({ label, bytes: partBytes })).sort((left, right) => right.bytes - left.bytes),
	};
}

export async function collectSummary(session: Session): Promise<SessionSummary> {
	const [profile, workspace] = await Promise.all([session.profile(), session.workspace()]);
	return {
		name: session.name,
		path: session.path,
		storage: session.storage,
		createdAt: profile?.createdAt ?? 0,
		...(profile?.persona ? { persona: profile.persona } : {}),
		...(profile?.forkedFrom ? { forkedFrom: profile.forkedFrom } : {}),
		...(profile?.pinned ? { pinned: true } : {}),
		running: session.running,
		...(workspace ? { workspace: { path: workspace.path, kind: workspace.kind, repo: workspace.repo } } : {}),
	};
}

export async function collectDetails(session: Session, sources: DetailsSources): Promise<SessionDetails> {
	const [summary, entries] = await Promise.all([collectSummary(session), session.rawEntries()]);
	const [contextUsage, model, size, skills, mcp, memory, schedules, runtime] = await Promise.all([
		session.contextUsage().catch(() => null),
		session.model(),
		sessionSize(session.root),
		sources.skills ? sources.skills.list(session).catch(() => []) : Promise.resolve([]),
		sources.mcp ? sources.mcp.statuses(session).catch(() => []) : Promise.resolve([]),
		buildMemoryOverview(session.root, entries).catch(() => null),
		sources.schedule ? sources.schedule.snapshot(session).catch(() => null) : Promise.resolve(null),
		sources.runtime ? sources.runtime.summary(session).catch(() => null) : Promise.resolve(null),
	]);
	const usage = aggregateUsage(entries);
	const billed = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
	const groups: ModelChoiceGroup[] = sources.models
		? (sources.settings.get().providers ?? [])
				.map((provider) => ({ provider, models: sources.models!.available(provider).map((model) => ({ id: model.id, name: model.name })) }))
				.filter((group) => group.models.length > 0)
		: [];
	let efforts: readonly string[] = [];
	if (sources.models) {
		try {
			efforts = [...sources.models.supportedThinkingLevels(sources.models.resolve(model ?? undefined))];
		} catch {
			efforts = [];
		}
	}

	return {
		...summary,
		activity: dailyActivity(entries, HEATMAP_WEEKS),
		usage,
		cacheShare: usage && billed > 0 ? (usage.cacheRead / billed) * 100 : null,
		context: contextUsage ? { used: contextUsage.used, window: contextUsage.window, percent: contextUsage.percent } : null,
		size,
		model: model ? { provider: model.provider, ...(model.modelId === undefined ? {} : { modelId: model.modelId }) } : null,
		models: groups,
		efforts,
		effort: session.thinkingLevel(),
		sandbox: sources.settings.get().defaultSandboxMode ?? "workspace-write",
		skills: skills.map((skill) => ({ name: skill.name, scope: skill.scope })),
		mcp,
		memory,
		schedules: schedules ? { schedules: schedules.schedules, runs: schedules.runs } : null,
		runtime,
	};
}

export const detailsExtension: Extension = {
	id: "details",
	apiVersion: 1,

	contributions: {
		"session.menu": [{ id: "details", order: 0, group: "view", title: "View details", icon: "info", action: "details.session" }],
	},

	activate(context) {
		const sources: DetailsSources = {
			models: context.models,
			schedule: context.get(ScheduleServiceId),
			skills: context.get(SkillsServiceId),
			mcp: context.get(McpServiceId),
			runtime: context.get(RuntimeStatsServiceId),
			settings: context.settings,
		};

		context.actions.register({
			id: "details.session",
			scope: "chat",
			hotkey: "Mod+E",
			run: async ({ session, dialog }) => {
				if (!session) throw new Error("details.session needs a session");
				await dialog?.({ kind: "custom", id: "session-details", title: session.name, data: await collectSummary(session) });
			},
		});

		context.actions.register({
			id: "details.collect",
			run: async ({ session }) => {
				if (!session) throw new Error("details.collect needs a session");
				return { data: await collectDetails(session, sources) };
			},
		});
	},
};
