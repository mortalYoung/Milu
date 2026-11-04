import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type AgentLoopEvent, type Session, type SessionService } from "@milu/core";
import { DisposableStore, createServiceId, type Service } from "@milu/di";

const FILE = "runtime-stats.json";

export interface RuntimeStatsSnapshot {
	turns: number;
	ttfts: number[];
	speedOutputs: number[];
	speedDurationsMs: number[];
	lastTtft: number | null;
	savedAt: number;
	sampling: "paired";
}

export interface RuntimeSummary {
	readonly turns: number;
	readonly avgTtftMs: number | null;
	readonly avgTps: number | null;
	readonly lastTtftMs: number | null;
}

interface TurnClock {
	readonly startedPerf: number;
	readonly startedWall: number;
	firstPerf: number;
	firstWall: number;
}

function emptySnapshot(): RuntimeStatsSnapshot {
	return { turns: 0, ttfts: [], speedOutputs: [], speedDurationsMs: [], lastTtft: null, savedAt: 0, sampling: "paired" };
}

function isNumbers(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

async function loadSnapshot(root: string): Promise<RuntimeStatsSnapshot> {
	try {
		const raw = JSON.parse(await readFile(join(root, FILE), "utf8")) as Partial<RuntimeStatsSnapshot>;
		if (typeof raw.turns !== "number" || !Number.isFinite(raw.turns) || raw.turns < 0) return emptySnapshot();
		if (!isNumbers(raw.ttfts)) return emptySnapshot();
		const speedOutputs = raw.speedOutputs;
		const speedDurationsMs = raw.speedDurationsMs;
		if (!isNumbers(speedOutputs) || !isNumbers(speedDurationsMs) || speedOutputs.length !== speedDurationsMs.length) {
			return { ...emptySnapshot(), turns: Math.floor(raw.turns) };
		}
		if (raw.lastTtft !== null && (typeof raw.lastTtft !== "number" || !Number.isFinite(raw.lastTtft))) return emptySnapshot();
		if (raw.sampling !== "paired") return { ...emptySnapshot(), turns: Math.floor(raw.turns) };
		return {
			turns: Math.floor(raw.turns),
			ttfts: [...raw.ttfts],
			speedOutputs: [...speedOutputs],
			speedDurationsMs: [...speedDurationsMs],
			lastTtft: raw.lastTtft ?? null,
			savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
			sampling: "paired",
		};
	} catch {
		return emptySnapshot();
	}
}

async function saveSnapshot(root: string, snapshot: RuntimeStatsSnapshot): Promise<void> {
	const file = join(root, FILE);
	const tmp = `${file}.tmp`;
	await mkdir(root, { recursive: true });
	await writeFile(tmp, `${JSON.stringify({ ...snapshot, savedAt: Date.now() }, null, 2)}\n`, "utf8");
	await rename(tmp, file);
}

function summarize(stats: RuntimeStatsSnapshot): RuntimeSummary {
	const average = (values: readonly number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
	const output = stats.speedOutputs.reduce((sum, value) => sum + value, 0);
	const durationMs = stats.speedDurationsMs.reduce((sum, value) => sum + value, 0);
	return {
		turns: stats.turns,
		avgTtftMs: average(stats.ttfts),
		avgTps: durationMs > 0 ? output / (durationMs / 1000) : null,
		lastTtftMs: stats.lastTtft,
	};
}

export class RuntimeStatsService implements Service {
	private readonly _clocks = new Map<string, TurnClock>();
	private readonly _stats = new Map<string, RuntimeStatsSnapshot>();
	private readonly _writes = new Map<string, Promise<void>>();
	private readonly _disposables = new DisposableStore();

	constructor(private readonly _sessionService: SessionService) {}

	initialize(): void {
		this._disposables.add(
			this._sessionService.onLoopEvent(({ session, event }) => {
				this._observe(session, event);
			}),
		);
	}

	async summary(session: Session): Promise<RuntimeSummary> {
		await this._writes.get(session.name)?.catch(() => undefined);
		const stats = await loadSnapshot(session.root);
		this._stats.set(session.name, stats);
		return summarize(stats);
	}

	dispose(): void {
		this._disposables.dispose();
		this._clocks.clear();
		this._stats.clear();
		this._writes.clear();
	}

	private _observe(name: string, event: AgentLoopEvent): void {
		const clock = this._clocks.get(name);
		switch (event.type) {
			case "turn_start":
				this._clocks.set(name, { startedPerf: performance.now(), startedWall: Date.now(), firstPerf: 0, firstWall: 0 });
				return;
			case "message_update": {
				if (!clock) return;
				if (clock.firstPerf === 0) {
					clock.firstPerf = performance.now();
					clock.firstWall = Date.now();
				}
				return;
			}
			case "message_end": {
				const message = event.message;
				if (!clock || clock.firstPerf === 0 || message.role !== "assistant" || !message.usage) return;
				if ((message as { stopReason?: unknown }).stopReason === "error") return;
				const ttft = clock.firstPerf - clock.startedPerf;
				const durationMs = Date.now() - clock.firstWall;
				const output = message.usage.output;
				clock.firstPerf = 0;
				clock.firstWall = 0;
				void this._update(
					name,
					(stats) => {
						stats.ttfts.push(ttft);
						stats.lastTtft = ttft;
						if (durationMs > 0) {
							stats.speedOutputs.push(output);
							stats.speedDurationsMs.push(durationMs);
						}
					},
					false,
				);
				return;
			}
			case "turn_end":
				void this._update(
					name,
					(stats) => {
						stats.turns += 1;
					},
					true,
				);
				return;
		}
	}

	private _update(name: string, mutate: (stats: RuntimeStatsSnapshot) => void, persist: boolean): Promise<void> {
		const previous = this._writes.get(name) ?? Promise.resolve();
		const next = previous
			.then(async () => {
				const session = this._sessionService.get(name);
				let snapshot = this._stats.get(name);
				if (!snapshot) {
					snapshot = await loadSnapshot(session.root);
					this._stats.set(name, snapshot);
				}
				mutate(snapshot);
				if (persist) await saveSnapshot(session.root, snapshot);
			})
			.catch((error: unknown) => console.error(`runtime ${name}: save failed:`, error));
		this._writes.set(name, next);
		return next;
	}
}

export const IRuntimeStatsService = createServiceId<RuntimeStatsService>("runtime.stats");
