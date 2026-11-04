import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface PaletteFile {
	readonly path: string;
	readonly name: string;
}

export interface PaletteFiles {
	readonly items: readonly PaletteFile[];
	readonly truncated: boolean;
}

/** Enough for a quick-open list, small enough that the walk can stop early. */
const LIMIT = 50;
/** Matches kept before ranking: a shallow `index.html` farm must not push `src/index.tsx` out. */
const CANDIDATE_LIMIT = 2000;
const TIME_BUDGET_MS = 2000;

/** Case-insensitive subsequence test — the same shape the palette ranks with, cheap enough for the walk. */
function matches(needle: string, haystack: string): boolean {
	const n = needle.trim().toLowerCase();
	if (n === "") return true;
	const h = haystack.toLowerCase();
	let at = 0;
	for (const ch of n) {
		at = h.indexOf(ch, at);
		if (at === -1) return false;
		at += 1;
	}
	return true;
}

export async function searchFiles(workspace: string, query: string, ignoreDirs: readonly string[], limit = LIMIT): Promise<PaletteFiles> {
	const ignore = new Set(ignoreDirs);
	const startedAt = Date.now();
	const items: PaletteFile[] = [];
	const queue: string[] = [""];
	let truncated = false;

	while (queue.length > 0) {
		if (items.length >= CANDIDATE_LIMIT || Date.now() - startedAt > TIME_BUDGET_MS) {
			truncated = true;
			break;
		}
		const dir = queue.shift() ?? "";
		let dirents: Dirent[];
		try {
			dirents = await readdir(join(workspace, dir), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const dirent of dirents) {
			if (ignore.has(dirent.name)) continue;
			const path = dir === "" ? dirent.name : `${dir}/${dirent.name}`;
			if (dirent.isDirectory()) {
				queue.push(path);
				continue;
			}
			if (!dirent.isFile()) continue;
			if (!matches(query, path)) continue;
			items.push({ path, name: dirent.name });
			if (items.length >= CANDIDATE_LIMIT) break;
		}
	}

	const trimmed = query.trim().toLowerCase();
	items.sort(
		(left, right) =>
			Number(right.path.toLowerCase() === trimmed) - Number(left.path.toLowerCase() === trimmed) ||
			left.path.split("/").length - right.path.split("/").length ||
			left.path.length - right.path.length ||
			left.path.localeCompare(right.path),
	);
	if (items.length > limit) {
		items.length = limit;
		truncated = true;
	}
	return { items, truncated };
}
