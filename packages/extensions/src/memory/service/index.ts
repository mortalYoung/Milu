import { EVENTS, type CompactionPlan, type Entry, type Model, type ModelsService, type Session, type SessionService, type SettingsPoint, type SettingsService } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { DEFAULT_DIGEST_MAX_ITEMS, planMemoryCompaction } from "../compact.ts";
import { buildPersonaReminder, buildSopIndexReminder, type MemoryReminder } from "../context.ts";
import { organizeMemory } from "../extract.ts";
import { organizePersona, personaSignature, readPersonaDoc } from "../persona.ts";
import { MAX_SOPS, organizeSops, sopIndex, type SopChange, sopSignature, sopUpdateReminder } from "../sop.ts";
import {
	activeRecords,
	checkpointCoversSession,
	entryIndexById,
	lastCheckpoint,
	latestCheckpointIndex,
	type MemoryCheckpoint,
	type QueryMemoryOptions,
	type MemoryQueryResult,
	queryMemory,
	readMemoryLines,
	readMemoryRunSummaries,
	readWatermarks,
	writeWatermark,
	type MemoryRecord,
	type MemoryRunLog,
	memoryPendingStatus,
} from "../store.ts";

const DEFAULT_PENDING_ROUNDS = 10;
const STAGE_DEBOUNCE_MS = 30_000;

export class MemoryService implements Service {
	private readonly _stageTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly _rounds = new Map<string, number>();
	private readonly _runs = new Map<string, Promise<number>>();
	private readonly _stageRuns = new Map<string, Promise<number>>();
	private readonly _sopChanges = new Map<string, SopChange[]>();
	private readonly _personaCache = new Map<string, { readonly signature: string; readonly reminder: MemoryReminder | null }>();
	private readonly _sopCache = new Map<string, { readonly signature: string; readonly reminder: MemoryReminder | null }>();
	private _watermarkChain: Promise<void> = Promise.resolve();
	private _enabled: SettingsPoint<boolean> | null = null;
	private _maxSops: SettingsPoint<number> | null = null;
	private _pendingRounds: SettingsPoint<number> | null = null;
	private _digestMaxItems: SettingsPoint<number> | null = null;

	constructor(
		private readonly _modelsService: ModelsService,
		private readonly _sessionService: SessionService,
		private readonly _settingsService: SettingsService,
	) {}

	async initialize(): Promise<void> {
		this._enabled = this._settingsService.declare({ key: "memoryEnabled", defaults: true });
		this._maxSops = this._settingsService.declare({ key: "memoryMaxSops", defaults: MAX_SOPS });
		this._pendingRounds = this._settingsService.declare({ key: "memoryPendingRounds", defaults: DEFAULT_PENDING_ROUNDS });
		this._digestMaxItems = this._settingsService.declare({ key: "memoryDigestMaxItems", defaults: DEFAULT_DIGEST_MAX_ITEMS });
		for (const name of await this._sessionService.names()) {
			const session = this._sessionService.get(name);
			void this._boot(session).catch((error: unknown) => console.error(`memory ${name}: boot failed:`, error));
		}
	}

	async read(session: Session, opts: QueryMemoryOptions): Promise<MemoryQueryResult> {
		return queryMemory(await readMemoryLines(session.root), opts);
	}

	async organize(session: Session): Promise<number> {
		if (this._enabled?.get() === false) return 0;
		const existing = this._runs.get(session.name);
		if (existing) return existing;
		const run = (async () => {
			const model = await this._modelOf(session);
			if (!model) return 0;
			const entries = await session.rawEntries();
			const added = await organizeMemory({
				dir: session.root,
				entries,
				model,
				streamFn: this._modelsService.stream,
				recentRounds: this._pendingRounds?.get(),
				logRun: this._runLog(session),
			});
			await this._stages(session, model);
			return added;
		})().finally(() => {
			this._runs.delete(session.name);
			this._rounds.set(session.name, 0);
		});
		this._runs.set(session.name, run);
		return run;
	}

	async sops(session: Session): Promise<number> {
		if (this._enabled?.get() === false) return 0;
		const model = await this._modelOf(session);
		if (!model) return 0;
		return this._singleStage("sop", session.name, async () => {
			const result = await this._runSopStage(session, model);
			return result.added;
		});
	}

	async persona(session: Session): Promise<number> {
		if (this._enabled?.get() === false) return 0;
		const model = await this._modelOf(session);
		if (!model) return 0;
		return this._singleStage("persona", session.name, async () => (await this._runPersonaStage(session, model)).writes);
	}

	async context(session: Session): Promise<{ persona: MemoryReminder | null }> {
		if (this._enabled?.get() === false) return { persona: null };
		const signature = await personaSignature(session.root);
		const cached = this._personaCache.get(session.name);
		if (cached && cached.signature === signature) return { persona: cached.reminder };
		const persona = await buildPersonaReminder(session.root);
		this._personaCache.set(session.name, { signature, reminder: persona });
		return { persona };
	}

	async sopIndex(session: Session): Promise<MemoryReminder | null> {
		if (this._enabled?.get() === false) return null;
		const signature = await sopSignature(session.root);
		const cached = this._sopCache.get(session.name);
		if (cached && cached.signature === signature) return cached.reminder;
		const reminder = await buildSopIndexReminder(session.root);
		this._sopCache.set(session.name, { signature, reminder });
		return reminder;
	}

	takeSopUpdates(name: string): MemoryReminder | null {
		const changes = this._sopChanges.get(name);
		if (!changes || changes.length === 0) return null;
		this._sopChanges.delete(name);
		return sopUpdateReminder(changes);
	}

	async planCompact(session: Session, entries: readonly Entry[]): Promise<CompactionPlan | null> {
		const enabled = this._enabled?.get() !== false;
		const flush = enabled ? await this._flushForCompact(session) : { memoryAvailable: false, covered: false, coveredIndex: -1 };
		const memoryEvents = enabled ? await this._sessionMemories(session.root, entries) : [];
		return planMemoryCompaction(entries, { ...flush, memoryEvents, digestMaxItems: this._digestMaxItems?.get() });
	}

	async status(session: Session): Promise<string> {
		const entries = await session.rawEntries();
		const lines = await readMemoryLines(session.root);
		const records = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint");
		const active = activeRecords(lines);
		const pending = await memoryPendingStatus(session.root, entries);
		const checkpoint = lastCheckpoint(lines);
		const runs = (await readMemoryRunSummaries(session.root, 5)).runs;
		const watermarks = await readWatermarks(session.root);
		const sops = await sopIndex(session.root);
		const persona = await personaSummary(session.root);
		return [
			`memory status · ${session.name}`,
			`atoms: ${records.length} (${active.length} active) · checkpoint ${checkpoint?.source.lastRawId ?? "none"} · pending ${pending.pending ? `${pending.rounds} rounds` : "none"}`,
			`watermarks: sop ${watermarks.sop ?? "none"} · persona ${watermarks.persona ?? "none"}`,
			`persona: ${persona ?? "none"} · sops: ${
				sops.length
					? `${sops.length} (${sops
							.slice(0, 5)
							.map((sop) => sop.id)
							.join(", ")})`
					: "none"
			}`,
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
			void this.organize(session).catch((error: unknown) => console.error(`memory ${name}: organize failed:`, error));
			return;
		}
		void this._schedule(session).catch((error: unknown) => console.error(`memory ${name}: schedule failed:`, error));
		if (this._runs.has(name)) return;
		void this._debouncedStages(session).catch((error: unknown) => console.error(`memory ${name}: stages failed:`, error));
	}

	dispose(): void {
		for (const timer of this._stageTimers.values()) clearTimeout(timer);
		this._stageTimers.clear();
		this._runs.clear();
		this._stageRuns.clear();
		this._rounds.clear();
		this._sopChanges.clear();
		this._personaCache.clear();
		this._sopCache.clear();
	}

	private async _boot(session: Session): Promise<void> {
		await this._schedule(session);
		if (this._runs.has(session.name)) return;
		await this._stagesAfterRun(session);
	}

	private async _stagesAfterRun(session: Session): Promise<void> {
		if (this._enabled?.get() === false) return;
		const model = await this._modelOf(session);
		if (!model) return;
		await this._stages(session, model);
	}

	private async _debouncedStages(session: Session): Promise<void> {
		const key = session.name;
		if (this._stageTimers.has(key)) return;
		const timer = setTimeout(() => {
			this._stageTimers.delete(key);
			void this._stagesAfterRun(session).catch((error: unknown) => console.error(`memory ${key}: stages failed:`, error));
		}, STAGE_DEBOUNCE_MS);
		this._stageTimers.set(key, timer);
	}

	private async _stages(session: Session, model: Model<any>): Promise<void> {
		const lines = await readMemoryLines(session.root);
		const watermarks = await readWatermarks(session.root);
		const newest = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint").at(-1)?.id;
		if (!newest) return;
		const sopDirty = watermarks.sop !== newest;
		const personaDirty = watermarks.persona !== newest;
		if (sopDirty) {
			await this._singleStage("sop", session.name, async () => (await this._runSopStage(session, model)).added);
		}
		if (personaDirty) {
			await this._singleStage("persona", session.name, async () => (await this._runPersonaStage(session, model)).writes);
		}
	}

	private async _runSopStage(session: Session, model: Model<any>): Promise<{ added: number }> {
		const result = await organizeSops({
			dir: session.root,
			model,
			streamFn: this._modelsService.stream,
			maxSops: this._maxSops?.get(),
			logRun: this._runLog(session),
		});
		if (result.changes.length > 0) this._recordSopChanges(session.name, result.changes);
		await this._watermark(session.root, "sop", result.through);
		return { added: result.added };
	}

	private async _runPersonaStage(session: Session, model: Model<any>): Promise<{ writes: number }> {
		const result = await organizePersona({ dir: session.root, model, streamFn: this._modelsService.stream, logRun: this._runLog(session) });
		await this._watermark(session.root, "persona", result.through);
		return { writes: result.writes };
	}

	private _watermark(dir: string, stage: "sop" | "persona", atomId: string | undefined): Promise<void> {
		const next = this._watermarkChain.then(() => writeWatermark(dir, stage, atomId)).catch((error: unknown) => console.error(`memory: ${stage} watermark write failed:`, error));
		this._watermarkChain = next;
		return next;
	}

	private _recordSopChanges(name: string, changes: readonly SopChange[]): void {
		this._sopChanges.set(name, [...(this._sopChanges.get(name) ?? []), ...changes]);
	}

	private _singleStage(stage: "sop" | "persona", name: string, run: () => Promise<number>): Promise<number> {
		const key = `${stage}:${name}`;
		const existing = this._stageRuns.get(key);
		if (existing) return existing;
		let promise: Promise<number>;
		promise = run()
			.catch((error: unknown) => {
				console.error(`memory ${name}: ${stage} failed:`, error);
				return 0;
			})
			.finally(() => {
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
		if (this._enabled?.get() === false) return;
		const entries = await session.rawEntries();
		const { pending, rounds } = await memoryPendingStatus(session.root, entries);
		this._rounds.set(session.name, rounds);
		if (!pending) return;
		const threshold = this._pendingRounds?.get() ?? DEFAULT_PENDING_ROUNDS;
		if (threshold > 0 && rounds >= threshold) {
			void this.organize(session).catch((error: unknown) => console.error(`memory ${session.name}: organize failed:`, error));
		}
	}
}

async function personaSummary(dir: string): Promise<string | null> {
	try {
		const persona = await readPersonaDoc(dir);
		return persona ? `rev ${persona.meta.rev} · ${persona.meta.updated} · ${persona.meta.sources.length} atoms` : null;
	} catch {
		return null;
	}
}

export const IMemoryService = createServiceId<MemoryService>("memory.service");
