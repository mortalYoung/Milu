import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fuzzyScore } from "../../shared/fuzzy";

export interface SearchFileItem {
	path: string;
	name: string;
}

export interface SearchFilesResult {
	items: SearchFileItem[];
	truncated: boolean;
}

/** Files returned per search: enough for a quick-open list, small enough for the traversal to stop early. */
export const SEARCH_FILE_LIMIT = 50;
/**
 * Matches kept before ranking. Ranking only the first N hits in walk order starves obvious targets
 * (a shallow `index.html` farm can push `src/index.tsx` out), so we collect generously and rank.
 */
const CANDIDATE_LIMIT = 2000;
const TIME_BUDGET_MS = 2000;

/**
 * Breadth-first file search: shallow hits win, the walk stops at `CANDIDATE_LIMIT` matches or
 * `TIME_BUDGET_MS`, and everything else is narrowed by the user typing more.
 */
export async function searchFiles(workspace: string, query: string, ignoreDirs: string[], limit = SEARCH_FILE_LIMIT): Promise<SearchFilesResult> {
	const ignore = new Set(ignoreDirs);
	const startedAt = Date.now();
	const candidates: (SearchFileItem & { score: number })[] = [];
	const queue: string[] = [""];
	let truncated = false;

	while (queue.length > 0) {
		if (candidates.length >= CANDIDATE_LIMIT || Date.now() - startedAt > TIME_BUDGET_MS) {
			truncated = true;
			break;
		}
		const dir = queue.shift()!;
		let dirents: Dirent[];
		try {
			dirents = await readdir(join(workspace, dir), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const dirent of dirents) {
			if (ignore.has(dirent.name)) continue;
			const path = dir ? `${dir}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				queue.push(path);
				continue;
			}
			if (!dirent.isFile()) continue;
			const score = fuzzyScore(query, path);
			if (score === null) continue;
			candidates.push({ path, name: dirent.name, score });
			if (candidates.length >= CANDIDATE_LIMIT) break;
		}
	}

	candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
	return { items: candidates.slice(0, limit).map(({ path, name }) => ({ path, name })), truncated };
}
