import type { SkillSummary } from "./types";

export function isSkillVisible(summary: SkillSummary, granted: string[]): boolean {
	return summary.scope === "project" || granted.includes(summary.name);
}

export function filterVisible(skills: SkillSummary[], granted: string[]): SkillSummary[] {
	return skills.filter((s) => isSkillVisible(s, granted));
}
