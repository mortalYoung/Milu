/**
 * Runtime timing metrics persistence (runs / TTFT / tok-s samples).
 *
 * These are process-global — one agent instance per process, one runtime object — so they live
 * in a single JSON file at DATABASE_ROOT (not in per-partner session logs, which would fragment
 * the samples across partners). Writes are atomic (tmp + rename), matching the append-only,
 * torn-write-repair philosophy of the JSONL session layer.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeStatsSnapshot } from "../../shared/rpc";

const FILE_NAME = "runtime-stats.json";

export function emptyRuntimeStats(): RuntimeStatsSnapshot {
	return { runs: 0, ttfts: [], speeds: [], lastTtft: null, savedAt: 0 };
}

/** Load the persisted snapshot; missing/corrupt files fall back to empty (never crash startup). */
export async function loadRuntimeStats(root: string): Promise<RuntimeStatsSnapshot> {
	try {
		const raw = JSON.parse(await readFile(join(root, FILE_NAME), "utf8")) as Partial<RuntimeStatsSnapshot>;
		if (typeof raw.runs !== "number" || !Number.isFinite(raw.runs) || raw.runs < 0) return emptyRuntimeStats();
		if (!Array.isArray(raw.ttfts) || !raw.ttfts.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) {
			return emptyRuntimeStats();
		}
		if (!Array.isArray(raw.speeds) || !raw.speeds.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) {
			return emptyRuntimeStats();
		}
		if (raw.lastTtft !== null && (typeof raw.lastTtft !== "number" || !Number.isFinite(raw.lastTtft))) {
			return emptyRuntimeStats();
		}
		return {
			runs: Math.floor(raw.runs),
			ttfts: raw.ttfts,
			speeds: raw.speeds,
			lastTtft: raw.lastTtft ?? null,
			savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
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
