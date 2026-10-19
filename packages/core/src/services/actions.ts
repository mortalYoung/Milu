import { createServiceId, type Disposable, type Service } from "@milu/di";
import type { BrowserCommand } from "@milu/protocol";

import type { Session } from "../session/session.ts";
import type { SessionService } from "./sessions.ts";

export interface ActionContext {
	readonly session?: Session;
	readonly args?: unknown;
	readonly sessions?: SessionService;
}

export interface Action {
	readonly id: string;
	readonly run: (context: ActionContext) => void | BrowserCommand | Promise<void | BrowserCommand>;
}

export class ActionRegistry implements Service {
	private readonly _actions = new Map<string, Action>();

	register(action: Action): Disposable {
		if (this._actions.has(action.id)) throw new Error(`action "${action.id}" is already registered`);
		this._actions.set(action.id, action);
		return {
			dispose: () => {
				this._actions.delete(action.id);
			},
		};
	}

	async run(id: string, context: ActionContext): Promise<BrowserCommand | undefined> {
		const action = this._actions.get(id);
		if (!action) throw new Error(`no action "${id}"`);
		return (await action.run(context)) ?? undefined;
	}

	dispose(): void {
		this._actions.clear();
	}
}

export const ActionRegistryId = createServiceId<ActionRegistry>("ActionRegistry");
