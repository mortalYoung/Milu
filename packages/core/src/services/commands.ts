import { createServiceId, type Disposable, type Service } from "@milu/di";
import type { ComposerCommand } from "@milu/protocol";

import { COMPOSER_COMMANDS_POINT } from "../extensions/types.ts";
import { EVENTS } from "../session/events.ts";
import type { Session } from "../session/session.ts";
import { IActionService, type ActionOutcome, type ActionService } from "./actions.ts";
import { IContributionService } from "./contributions.ts";
import type { ContributionService } from "./contributions.ts";

export interface ComposerCommandSource {
	readonly id: string;
	list(session: Session | null): Promise<readonly ComposerCommand[]> | readonly ComposerCommand[];
}

export class CommandsService implements Service {
	private readonly _sources: ComposerCommandSource[] = [];

	constructor(
		@IContributionService private readonly _contributionService: ContributionService,
		@IActionService private readonly _actions: ActionService,
	) {}

	register(source: ComposerCommandSource): Disposable {
		if (this._sources.some((each) => each.id === source.id)) throw new Error(`command source "${source.id}" is already registered`);
		this._sources.push(source);
		return {
			dispose: () => {
				const at = this._sources.indexOf(source);
				if (at >= 0) this._sources.splice(at, 1);
			},
		};
	}

	async list(session: Session | null = null): Promise<readonly ComposerCommand[]> {
		const contributed = this._contributionService.get<ComposerCommand>(COMPOSER_COMMANDS_POINT).all();
		const sourced = await Promise.all(this._sources.map((source) => source.list(session)));
		return [...contributed, ...sourced.flat()];
	}

	async run(session: Session, name: string, input = ""): Promise<ActionOutcome> {
		const command = (await this.list(session)).find((each) => each.name === name);
		if (!command) throw new Error(`no command "/${name}"`);
		const args = input.trim();
		const commandId = `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		await session.record(EVENTS.commandRun, { commandId, name: command.name, ...(args === "" ? {} : { args }), timestamp: Date.now() });
		try {
			const outcome = await this._actions.run(command.action, { session, args: { name: command.name, args } });
			const text = outcomeText(outcome);
			await session.record(EVENTS.commandDone, { commandId, kind: "success", ...(text === "" ? {} : { text }), timestamp: Date.now() });
			return outcome;
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			await session.record(EVENTS.commandDone, { commandId, kind: "error", text, timestamp: Date.now() });
			return undefined;
		}
	}

	dispose(): void {
		this._sources.length = 0;
	}
}

function outcomeText(outcome: ActionOutcome): string {
	if (!outcome || typeof outcome !== "object" || !("data" in outcome)) return "";
	const data = outcome.data;
	if (data === undefined || data === null || data === "") return "";
	return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

export const ICommandsService = createServiceId<CommandsService>("CommandsService");
