import { homedir } from "node:os";

import { expandHome, type Session, type SettingsPoint, type SettingsService } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { getSkill, listAllSkills, listGlobalSkills, listSkills, type SkillDefinition, type SkillLookup, type SkillSummary } from "../catalog.ts";
import { grantedSkills } from "../grants.ts";

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

	dirs(): readonly string[] {
		if (!this._dirs) throw new Error("SkillsService is not initialized");
		const dirs = this._dirs.get();
		return dirs.length > 0 ? dirs : [".agents/skills"];
	}

	async candidates(session: Session): Promise<readonly SkillSummary[]> {
		return listAllSkills(await this._lookup(session));
	}

	async global(): Promise<readonly SkillSummary[]> {
		if (!this._dirs) throw new Error("SkillsService is not initialized");
		return listGlobalSkills({ home: homedir(), skillsDirs: this._dirs.get() });
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
