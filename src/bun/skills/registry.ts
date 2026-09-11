import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { filterVisible } from "./authorize";
import { type SkillCandidate, scanSkillsRoot } from "./filesystem";
import { parseSkillFile, SKILL_NAME_RE } from "./frontmatter";
import type { SkillDefinition, SkillLookup, SkillSummary } from "./types";

export async function listSkills(lookup: SkillLookup): Promise<SkillSummary[]> {
	return filterVisible(await listSkillCandidates(lookup), lookup.granted);
}

export async function listSkillCandidates(lookup: Omit<SkillLookup, "granted">): Promise<SkillSummary[]> {
	const dirs = lookup.skillsDirs.length > 0 ? lookup.skillsDirs : [".agents/skills"];
	const candidates: SkillCandidate[] = [];
	for (let i = 0; i < dirs.length; i++) {
		const rank = 100 + i * 10;
		const projectRoot = lookup.cwd ? join(lookup.cwd, dirs[i]) : null;
		if (projectRoot) candidates.push(...(await scanSkillsRoot(projectRoot, "project", "project-agents", rank)));
		candidates.push(...(await scanSkillsRoot(join(lookup.home, dirs[i]), "global", "global", rank + 1)));
	}
	const byName = new Map<string, SkillCandidate>();
	for (const candidate of candidates) {
		const existing = byName.get(candidate.name);
		if (!existing) {
			byName.set(candidate.name, candidate);
			continue;
		}
		if (candidate.scope === "project" && existing.scope !== "project") {
			byName.set(candidate.name, candidate);
			continue;
		}
		if (candidate.scope === existing.scope && candidate.rank < existing.rank) {
			byName.set(candidate.name, candidate);
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(name: string, lookup: SkillLookup): Promise<SkillDefinition | undefined> {
	if (!SKILL_NAME_RE.test(name)) return undefined;
	const summary = (await listSkills(lookup)).find((s) => s.name === name);
	if (!summary?.path) return undefined;
	try {
		const parsed = parseSkillFile(await readFile(summary.path, "utf8"));
		if (!parsed || parsed.name !== name) return undefined;
		return { ...summary, content: parsed.content, ...(parsed.metadata ? { metadata: parsed.metadata } : {}) };
	} catch {
		return undefined;
	}
}
