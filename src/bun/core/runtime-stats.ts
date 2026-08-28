/**
 * Runtime timing metrics persistence (runs / TTFT / tok-s samples).
 *
 * One file per partner root — each partner owns an agent with its own runtime object, seeded from
 * its dir on launch and written through after every sampled turn (per-agent files keep concurrent
 * runs from clobbering each other's samples). Writes are atomic (tmp + rename), matching the
 * append-only, torn-write-repair philosophy of the JSONL session layer.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeStatsSnapshot } from "../../shared/rpc";

const FILE_NAME = "runtime-stats.json";

export function emptyRuntimeStats(): RuntimeStatsSnapshot {
	return { runs: 0, ttfts: [], speedOutputs: [], speedDurationsMs: [], lastTtft: null, savedAt: 0, sampling: "paired" };
}

/** Load the persisted snapshot; missing/corrupt files fall back to empty (never crash startup). */
export async function loadRuntimeStats(root: string): Promise<RuntimeStatsSnapshot> {
	try {
		const raw = JSON.parse(await readFile(join(root, FILE_NAME), "utf8")) as Partial<RuntimeStatsSnapshot>;
		if (typeof raw.runs !== "number" || !Number.isFinite(raw.runs) || raw.runs < 0) return emptyRuntimeStats();
		if (!Array.isArray(raw.ttfts) || !raw.ttfts.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) {
			return emptyRuntimeStats();
		}
		const speedOutputs = Array.isArray(raw.speedOutputs) ? raw.speedOutputs : null;
		const speedDurationsMs = Array.isArray(raw.speedDurationsMs) ? raw.speedDurationsMs : null;
		if (
			speedOutputs === null ||
			speedDurationsMs === null ||
			speedOutputs.length !== speedDurationsMs.length ||
			!speedOutputs.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) ||
			!speedDurationsMs.every((n: unknown) => typeof n === "number" && Number.isFinite(n))
		) {
			return { ...emptyRuntimeStats(), runs: Math.floor(raw.runs) };
		}
		if (raw.lastTtft !== null && (typeof raw.lastTtft !== "number" || !Number.isFinite(raw.lastTtft))) {
			return emptyRuntimeStats();
		}
		if (raw.sampling !== "paired") {
			return { ...emptyRuntimeStats(), runs: Math.floor(raw.runs) };
		}
		return {
			runs: Math.floor(raw.runs),
			ttfts: raw.ttfts,
			speedOutputs,
			speedDurationsMs,
			lastTtft: raw.lastTtft ?? null,
			savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
			sampling: "paired",
		};
	} catch {
		return emptyRuntimeStats();
	}
}

/** Persist the snapshot atomically (tmp + rename so a torn write can't corrupt the file). */
export async function saveRuntimeStats(root: string, snapshot: RuntimeStatsSnapshot): Promise<void> {
	const file = join(root, FILE_NAME);
	const tmp = `${file}.tmp`;
	await mkdir(root, { recursive: true });
	await writeFile(tmp, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
	await rename(tmp, file);
}
