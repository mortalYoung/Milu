import type { SkillSummary } from "./types";

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderAvailableSkills(skills: SkillSummary[]): string {
	if (skills.length === 0) return "";
	const lines = skills.map((s) => `- ${escapeXml(s.name)}: ${escapeXml(s.description)}`);
	return `<available_skills>\n${lines.join("\n")}\n</available_skills>\n\nWhen a task matches a skill above, call the skill tool with its exact name to load the full instructions. The latest <available_skills> message is authoritative.`;
}
