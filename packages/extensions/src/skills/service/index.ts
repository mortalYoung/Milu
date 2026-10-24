import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { expandHome, type Session, type SettingsPoint, type SettingsService } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { getSkill, listSkills, type SkillDefinition, type SkillLookup, type SkillSummary } from "../catalog.ts";

const DEFAULT_SKILLS_DIRS = [".agents/skills"];

export class SkillsService implements Service {
	private _dirs: SettingsPoint<string[]> | null = null;

	constructor(private readonly _settingsService: SettingsService) {}

	initialize(): void {
		this._dirs = this._settingsService.declare({ key: "skills_dirs", defaults: DEFAULT_SKILLS_DIRS });
	}

	async list(session: Session): Promise<readonly SkillSummary[]> {
		return listSkills(await this._lookup(session));
	}

	async get(session: Session, name: string): Promise<SkillDefinition | undefined> {
		return getSkill(name, await this._lookup(session));
	}

	dispose(): void {}

	private async _lookup(session: Session): Promise<SkillLookup> {
		if (!this._dirs) throw new Error("SkillsService is not initialized");
		const workspace = await session.workspace();
		return {
			cwd: workspace ? expandHome(workspace.path) : null,
			home: homedir(),
			skillsDirs: this._dirs.get(),
			granted: await grantedSkills(session),
		};
	}
}

export const ISkillsService = createServiceId<SkillsService>("skills.service");

async function grantedSkills(session: Session): Promise<string[]> {
	const text = await readFile(join(session.root, "granted-skills.json"), "utf8").catch(() => null);
	if (text === null) return [];
	try {
		const saved = JSON.parse(text) as { skills?: unknown };
		return Array.isArray(saved.skills) ? saved.skills.filter((name): name is string => typeof name === "string") : [];
	} catch {
		return [];
	}
}
