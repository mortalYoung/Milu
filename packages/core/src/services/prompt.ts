import { createServiceId, type Service } from "@milu/di";

import { SYSTEM_PROMPT_POINT, type PromptSection } from "../extensions/types.ts";
import type { Session } from "../session/session.ts";
import { IContributionService } from "./contributions.ts";
import type { ContributionPoint, ContributionService } from "./contributions.ts";

export class PromptService implements Service {
	private readonly _point: ContributionPoint<PromptSection>;

	constructor(@IContributionService private readonly _contributionService: ContributionService) {
		this._point = this._contributionService.declare<PromptSection>(SYSTEM_PROMPT_POINT);
	}

	async compose(session: Session): Promise<string> {
		const sections = [...this._point.all()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
		for (let index = 1; index < sections.length; index += 1) {
			const previous = sections[index - 1];
			const current = sections[index];
			if (!previous || !current || previous.order !== current.order) continue;
			throw new Error(`prompt sections "${previous.id}" and "${current.id}" share order ${current.order}`);
		}

		const parts: string[] = [];
		for (const section of sections) {
			const value = typeof section.text === "function" ? await section.text(session) : section.text;
			const text = typeof value === "string" ? value.trim() : "";
			if (text !== "") parts.push(text);
		}
		return parts.join("\n\n");
	}

	dispose(): void {}
}

export const IPromptService = createServiceId<PromptService>("PromptService");
