import { createServiceId, type Service } from "@milu/di";
import type { ComposerCommand } from "@milu/protocol";

import { COMPOSER_COMMANDS_POINT } from "../extensions/types.ts";
import type { ContributionService } from "./contributions.ts";

export class CommandsService implements Service {
	constructor(private readonly _contributions: ContributionService) {}

	list(): readonly ComposerCommand[] {
		return this._contributions.get<ComposerCommand>(COMPOSER_COMMANDS_POINT).all();
	}

	dispose(): void {}
}

export const CommandsServiceId = createServiceId<CommandsService>("CommandsService");
