import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { filterVisible } from "./authorize";
import { scanSkillsRoot } from "./filesystem";
import { parseSkillFile, SKILL_NAME_RE } from "./frontmatter";
import type { SkillDefinition, SkillLookup, SkillSummary } from "./types";

const PROJECT_RANK = 100;
const GLOBAL_RANK = 200;

export async function listSkills(lookup: SkillLookup): Promise<SkillSummary[]> {
	const projectRoot = lookup.cwd ? join(lookup.cwd, lookup.skillsDir) : null;
	const globalRoot = join(lookup.home, lookup.skillsDir);
	const [project, global] = await Promise.all([
		projectRoot ? scanSkillsRoot(projectRoot, "project", "project-agents", PROJECT_RANK) : Promise.resolve([]),
		scanSkillsRoot(globalRoot, "global", "global", GLOBAL_RANK),
	]);
	const byName = new Map<string, SkillSummary>();
	for (const candidate of [...project, ...global]) {
		if (!filterVisible([candidate], lookup.granted).length) continue;
		const existing = byName.get(candidate.name);
		if (!existing || (existing.scope !== "project" && candidate.scope === "project")) {
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
