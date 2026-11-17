import { readFile, rename, writeFile } from "node:fs/promises";

const LEGACY = '"customType":"compaction"';
const RENAMED = '"customType":"compaction/summary"';

export interface LegacyConsolidation {
	readonly text: string;
	readonly dropped: number;
}

export function consolidateLegacyCompaction(text: string): LegacyConsolidation | null {
	if (!text.includes(LEGACY)) return null;
	const lines = text.split("\n");
	const at: number[] = [];
	for (const [index, line] of lines.entries()) {
		if (!line.includes(LEGACY)) continue;
		try {
			const entry = JSON.parse(line) as { type?: unknown; customType?: unknown };
			if (entry.type === "custom" && entry.customType === "compaction") at.push(index);
		} catch {}
	}
	if (at.length === 0) return null;
	// 只保留最后一次压缩：每次压缩的 shadowedIds 都从日志开头切起，最后一条已经覆盖了
	// 前面所有记录（含它们的 checkpoint 条目），所以丢掉它们不会改变投影结果。
	const dropped = new Set(at.slice(0, -1));
	const renamed = at[at.length - 1]!;
	const out: string[] = [];
	for (const [index, line] of lines.entries()) {
		if (dropped.has(index)) continue;
		out.push(index === renamed ? line.replace(LEGACY, RENAMED) : line);
	}
	return { text: out.join("\n"), dropped: dropped.size };
}

export async function migrateLegacyCompaction(path: string): Promise<number> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return 0;
	}
	const consolidated = consolidateLegacyCompaction(text);
	if (!consolidated) return 0;
	const rewritten = consolidated.text.split("\n").find((line) => line.includes(RENAMED));
	if (rewritten !== undefined) {
		try {
			JSON.parse(rewritten);
		} catch {
			console.error(`session log migration skipped (${path}): the rewritten record does not parse`);
			return 0;
		}
	}
	const temporary = `${path}.migrating`;
	try {
		await writeFile(temporary, consolidated.text, "utf8");
		await rename(temporary, path);
	} catch (error) {
		console.error(`session log migration failed (${path}):`, error);
		return 0;
	}
	return consolidated.dropped;
}
