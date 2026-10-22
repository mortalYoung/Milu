import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { EVENTS, type CompactionPlan, type Entry, type Model, type ModelsService, type Session, type SessionService, type SettingsPoint, type SettingsService } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { planMemoryCompaction } from "./compact.ts";
import { consolidateMemory } from "./consolidate.ts";
import { buildMemoryContext, type MemoryContext } from "./context.ts";
import { organizeMemory } from "./extract.ts";
import { buildMemoryOverview, type MemoryOverview } from "./overview.ts";
import { latestPersona, organizePersona, personaTrigger, readPersonaLines, rebuildPersonaView } from "./persona.ts";
import { DEFAULT_MAX_SCENES, foldScenes, MEMORY_SCENE_BATCH, organizeScenes, readSceneLines, rebuildSceneViews, scenePendingCount } from "./scenes.ts";
import {
	checkpointCoversSession,
	entryIndexById,
	lastCheckpoint,
	latestCheckpointIndex,
	type MemoryCheckpoint,
	type MemoryRecord,
	type MemoryRunLog,
	memoryPendingStatus,
	queryMemory,
	readMemoryLines,
	readMemoryRunSummaries,
} from "./store.ts";

const DEFAULT_IDLE_MINUTES = 5;
const DEFAULT_PENDING_ROUNDS = 10;

export class MemoryService implements Service {
	private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly _rounds = new Map<string, number>();
	private readonly _runs = new Map<string, Promise<number>>();
	private readonly _stageRuns = new Map<string, Promise<number>>();
	private _enabled: SettingsPoint<boolean> | null = null;
	private _idleMinutes: SettingsPoint<number> | null = null;
	private _maxScenes: SettingsPoint<number> | null = null;
	private _pendingRounds: SettingsPoint<number> | null = null;

	constructor(
		private readonly _modelsService: ModelsService,
		private readonly _sessionService: SessionService,
		private readonly _settingsService: SettingsService,
	) {}

	async initialize(): Promise<void> {
		this._enabled = this._settingsService.declare({ key: "memoryEnabled", defaults: true });
		this._idleMinutes = this._settingsService.declare({ key: "memoryIdleMinutes", defaults: DEFAULT_IDLE_MINUTES });
		this._maxScenes = this._settingsService.declare({ key: "memoryMaxScenes", defaults: DEFAULT_MAX_SCENES });
		this._pendingRounds = this._settingsService.declare({ key: "memoryPendingRounds", defaults: DEFAULT_PENDING_ROUNDS });
		for (const name of await this._sessionService.names()) {
			const session = this._sessionService.get(name);
			void this._boot(session).catch((error: unknown) => console.error(`memory ${name}: boot failed:`, error));
		}
	}

	async read(session: Session, opts: { query?: string; kinds?: readonly MemoryRecord["kind"][]; limit?: number; includeSuperseded?: boolean }): Promise<MemoryRecord[]> {
		return queryMemory(await readMemoryLines(session.root), opts);
	}

	async overview(session: Session, entries?: readonly Entry[]): Promise<MemoryOverview> {
		return buildMemoryOverview(session.root, entries ?? (await session.rawEntries()));
	}

	async organize(session: Session): Promise<number> {
		if (this._enabled?.get() === false) return 0;
		const existing = this._runs.get(session.name);
		if (existing) return existing;
		const run = (async () => {
			const model = await this._modelOf(session);
			if (!model) return 0;
			const entries = await session.rawEntries();
			const added = await organizeMemory({ dir: session.root, entries, model, streamFn: this._modelsService.stream, logRun: this._runLog(session) });
			await this._stages(session, model);
			return added;
		})().finally(() => {
			this._runs.delete(session.name);
			this._rounds.set(session.name, 0);
		});
		this._runs.set(session.name, run);
		return run;
	}

	async scenes(session: Session, force = false): Promise<number> {
		if (this._enabled?.get() === false) return 0;
		const model = await this._modelOf(session);
		if (!model) return 0;
		return this._singleStage("scene", session.name, () =>
			organizeScenes({
				dir: session.root,
				model,
				streamFn: this._modelsService.stream,
				reason: force ? "manual" : "threshold",
				maxScenes: this._maxScenes?.get(),
				logRun: this._runLog(session),
			}),
		);
	}

	async consolidate(session: Session): Promise<number> {
		if (this._enabled?.get() === false) return 0;
		const model = await this._modelOf(session);
		if (!model) return 0;
		return this._singleStage("consolidate", session.name, () =>
			consolidateMemory({ dir: session.root, model, streamFn: this._modelsService.stream, logRun: this._runLog(session) }),
		);
	}

	async persona(session: Session, force = false): Promise<number> {
		if (this._enabled?.get() === false) return 0;
		const model = await this._modelOf(session);
		if (!model) return 0;
		const trigger = force ? { run: true, reason: "manual" as const } : await personaTrigger(session.root);
		if (!trigger.run || !trigger.reason) return 0;
		const reason = trigger.reason;
		return this._singleStage("persona", session.name, () =>
			organizePersona({
				dir: session.root,
				model,
				streamFn: this._modelsService.stream,
				reason,
				...(force ? { force: true } : {}),
				logRun: this._runLog(session),
			}),
		);
	}

	async context(session: Session): Promise<MemoryContext | null> {
		if (this._enabled?.get() === false) return null;
		return buildMemoryContext(session.root);
	}

	async planCompact(session: Session, entries: readonly Entry[]): Promise<CompactionPlan | null> {
		const enabled = this._enabled?.get() !== false;
		const flush = enabled ? await this._flushForCompact(session) : { memoryAvailable: false, covered: false, coveredIndex: -1 };
		const memoryEvents = enabled ? await this._sessionMemories(session.root, entries) : [];
		return planMemoryCompaction(entries, { ...flush, memoryEvents, digestMaxItems: this._settingsService.get().compaction?.digestMaxItems });
	}

	async status(session: Session): Promise<string> {
		const entries = await session.rawEntries();
		const lines = await readMemoryLines(session.root);
		const records = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint");
		const active = queryMemory(lines, { limit: Number.MAX_SAFE_INTEGER });
		const pending = await memoryPendingStatus(session.root, entries);
		const checkpoint = lastCheckpoint(lines);
		const runs = (await readMemoryRunSummaries(session.root, 5)).runs;
		const persona = await personaSummary(session.root);
		const scenes = await sceneSummary(session.root);
		return [
			`memory status · ${session.name}`,
			`memory: ${records.length} records (${active.length} active) · checkpoint ${checkpoint?.source.lastRawId ?? "none"} · pending ${pending.pending ? `${pending.rounds} rounds` : "none"}`,
			`profile: ${persona ?? "none"} · scenes: ${scenes ?? "none"}`,
			"runs:",
			...(runs.length
				? runs.map(
						(run) =>
							`  [${new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 16)}] ${run.stage} ${run.reason} added=${run.added} ${(run.durationMs / 1000).toFixed(1)}s`,
					)
				: ["  (none)"]),
		].join("\n");
	}

	afterRun(name: string): void {
		if (this._enabled?.get() === false) return;
		const session = this._sessionService.get(name);
		const rounds = (this._rounds.get(name) ?? 0) + 1;
		this._rounds.set(name, rounds);
		const threshold = this._pendingRounds?.get() ?? DEFAULT_PENDING_ROUNDS;
		if (threshold > 0 && rounds >= threshold) {
			this._cancel(name);
			void this.organize(session).catch((error: unknown) => console.error(`memory ${name}: organize failed:`, error));
			return;
		}
		void this._schedule(session).catch((error: unknown) => console.error(`memory ${name}: schedule failed:`, error));
		if (this._runs.has(name)) return;
		void this._stagesAfterRun(session).catch((error: unknown) => console.error(`memory ${name}: stages failed:`, error));
	}

	dispose(): void {
		for (const timer of this._timers.values()) clearTimeout(timer);
		this._timers.clear();
		this._runs.clear();
		this._stageRuns.clear();
		this._rounds.clear();
	}

	private async _boot(session: Session): Promise<void> {
		await this._rebuildViews(session);
		await this._schedule(session);
		if (this._runs.has(session.name)) return;
		await this._stagesAfterRun(session);
	}

	private async _rebuildViews(session: Session): Promise<void> {
		const scenes = foldScenes(await readSceneLines(session.root));
		if (scenes.length > 0) await rebuildSceneViews(session.root);
		if (latestPersona(await readPersonaLines(session.root))) await rebuildPersonaView(session.root);
	}

	private async _stagesAfterRun(session: Session): Promise<void> {
		if (this._enabled?.get() === false) return;
		const model = await this._modelOf(session);
		if (!model) return;
		await this._stages(session, model);
	}

	private async _stages(session: Session, model: Model<any>): Promise<void> {
		const pending = await scenePendingCount(session.root);
		if (pending >= MEMORY_SCENE_BATCH) {
			await this._singleStage("scene", session.name, () =>
				organizeScenes({
					dir: session.root,
					model,
					streamFn: this._modelsService.stream,
					reason: "threshold",
					maxScenes: this._maxScenes?.get(),
					logRun: this._runLog(session),
				}),
			);
		}
		const trigger = await personaTrigger(session.root);
		if (trigger.run && trigger.reason) {
			const reason = trigger.reason;
			await this._singleStage("persona", session.name, () =>
				organizePersona({ dir: session.root, model, streamFn: this._modelsService.stream, reason, logRun: this._runLog(session) }),
			);
		}
	}

	private _singleStage(stage: "scene" | "persona" | "consolidate", name: string, run: () => Promise<number>): Promise<number> {
		const key = `${stage}:${name}`;
		const existing = this._stageRuns.get(key);
		if (existing) return existing;
		let promise: Promise<number>;
		promise = run().finally(() => {
			if (this._stageRuns.get(key) === promise) this._stageRuns.delete(key);
		});
		this._stageRuns.set(key, promise);
		return promise;
	}

	private async _flushForCompact(session: Session): Promise<{ memoryAvailable: boolean; covered: boolean; coveredIndex: number }> {
		try {
			await this.organize(session);
		} catch (error) {
			console.error(`memory ${session.name}: compact flush failed:`, error);
		}
		const entries = await session.rawEntries();
		const lines = await readMemoryLines(session.root);
		const checkpoints = lines.filter((line): line is MemoryCheckpoint => line.kind === "checkpoint");
		return {
			memoryAvailable: true,
			covered: checkpointCoversSession(checkpoints, entries),
			coveredIndex: latestCheckpointIndex(lines, entryIndexById(entries)),
		};
	}

	private async _sessionMemories(dir: string, entries: readonly Entry[]): Promise<MemoryRecord[]> {
		const ids = new Set(entries.map((entry) => entry.id));
		const lines = await readMemoryLines(dir);
		return lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint" && line.source.rawIds.some((id) => ids.has(id)));
	}

	private _runLog(session: Session): MemoryRunLog {
		return {
			start: async ({ runId, stage, startedAt }) => {
				await session.record(EVENTS.memoryRunStart, { runId, stage, startedAt, timestamp: startedAt });
			},
			end: async ({ runId, stage, startedAt, endedAt, reason, added }) => {
				await session.record(EVENTS.memoryRunEnd, { runId, stage, startedAt, endedAt, reason, added, timestamp: endedAt });
			},
		};
	}

	private async _modelOf(session: Session): Promise<Model<any> | null> {
		try {
			const model = await session.model();
			return this._modelsService.resolve(model ?? undefined);
		} catch {
			return null;
		}
	}

	private async _schedule(session: Session): Promise<void> {
		if (this._enabled?.get() === false) {
			this._cancel(session.name);
			return;
		}
		const entries = await session.rawEntries();
		const { pending, rounds } = await memoryPendingStatus(session.root, entries);
		this._rounds.set(session.name, rounds);
		if (!pending) {
			this._cancel(session.name);
			return;
		}
		const threshold = this._pendingRounds?.get() ?? DEFAULT_PENDING_ROUNDS;
		if (threshold > 0 && rounds >= threshold) {
			this._cancel(session.name);
			void this.organize(session).catch((error: unknown) => console.error(`memory ${session.name}: organize failed:`, error));
			return;
		}
		const minutes = this._idleMinutes?.get() ?? DEFAULT_IDLE_MINUTES;
		if (minutes <= 0) {
			this._cancel(session.name);
			return;
		}
		const last = (await session.row()).lastMessageAt ?? null;
		const elapsed = last === null ? Number.POSITIVE_INFINITY : Date.now() - last;
		if (elapsed >= minutes * 60_000) {
			void this.organize(session).catch((error: unknown) => console.error(`memory ${session.name}: organize failed:`, error));
			return;
		}
		this._cancel(session.name);
		const timer = setTimeout(
			() => {
				this._timers.delete(session.name);
				void this.organize(session).catch((error: unknown) => console.error(`memory ${session.name}: organize failed:`, error));
			},
			minutes * 60_000 - elapsed,
		);
		this._timers.set(session.name, timer);
	}

	private _cancel(name: string): void {
		const timer = this._timers.get(name);
		if (timer) clearTimeout(timer);
		this._timers.delete(name);
	}
}

async function personaSummary(dir: string): Promise<string | null> {
	try {
		const raw = await readFile(join(dir, ".memory", "persona.jsonl"), "utf8");
		let latest: { version: number; createdAt: number; sourceSceneIds?: unknown[] } | null = null;
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as { version?: unknown; createdAt?: unknown; sourceSceneIds?: unknown[] };
				if (typeof parsed.version !== "number" || typeof parsed.createdAt !== "number") continue;
				if (!latest || parsed.version >= latest.version) latest = { version: parsed.version, createdAt: parsed.createdAt, sourceSceneIds: parsed.sourceSceneIds };
			} catch {}
		}
		return latest ? `v${latest.version} · ${new Date(latest.createdAt).toISOString().slice(0, 10)} · ${latest.sourceSceneIds?.length ?? 0} scenes` : null;
	} catch {
		return null;
	}
}

async function sceneSummary(dir: string): Promise<string | null> {
	try {
		const raw = await readFile(join(dir, ".memory", "scenes.jsonl"), "utf8");
		let revisions = 0;
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as { kind?: unknown };
				if (parsed.kind === "revision") revisions += 1;
			} catch {}
		}
		return `${revisions} revisions`;
	} catch {
		return null;
	}
}

export const MemoryServiceId = createServiceId<MemoryService>("memory.service");
