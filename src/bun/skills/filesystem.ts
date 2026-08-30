import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseSkillFile } from "./frontmatter";
import type { SkillScope, SkillSummary } from "./types";

export interface SkillCandidate extends SkillSummary {
	rank: number;
}

export async function scanSkillsRoot(root: string, scope: SkillScope, source: SkillSummary["source"], rank: number): Promise<SkillCandidate[]> {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const out: SkillCandidate[] = [];
	for (const entry of entries) {
		const full = join(root, entry.name);
		let file: string | null = null;
		if (entry.isDirectory()) {
			const skillFile = join(full, "SKILL.md");
			try {
				if ((await stat(skillFile)).isFile()) file = skillFile;
			} catch {
				file = null;
			}
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			file = full;
		}
		if (!file) continue;
		try {
			const parsed = parseSkillFile(await readFile(file, "utf8"));
			if (!parsed) {
				console.warn(`skill: dropped invalid skill at ${full}`);
				continue;
			}
			out.push({ ...parsed, scope, source, path: file, rank });
		} catch (error) {
			console.warn(`skill: failed to read ${full}`, error);
		}
	}
	return out;
}
