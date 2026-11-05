import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Session } from "@milu/core";

function grantsPath(session: Session): string {
	return join(session.root, "granted-skills.json");
}

export async function grantedSkills(session: Session): Promise<string[]> {
	const text = await readFile(grantsPath(session), "utf8").catch(() => null);
	if (text === null) return [];
	try {
		const saved = JSON.parse(text) as { skills?: unknown };
		return Array.isArray(saved.skills) ? saved.skills.filter((name): name is string => typeof name === "string") : [];
	} catch {
		return [];
	}
}

export async function setGrantedSkill(session: Session, name: string, granted: boolean): Promise<void> {
	const current = await grantedSkills(session);
	const next = granted ? (current.includes(name) ? current : [...current, name]) : current.filter((each) => each !== name);
	if (next.length === current.length) return;
	await writeFile(grantsPath(session), `${JSON.stringify({ skills: next }, null, 2)}\n`, "utf8");
}
