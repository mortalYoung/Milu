import { createServiceId, type Disposable, type Service } from "@milu/di";

import type { Session } from "../session/session.ts";

export interface ActionContext {
	/** Present when the action was invoked from a session — a row's menu, or a shortcut. */
	readonly session?: Session;
}

export interface Action {
	readonly id: string;
	readonly run: (context: ActionContext) => void | Promise<void>;
}

/**
 * The only way an extension can *do* something. The wire protocol is a closed set of methods, so
 * a command from an extension arrives as one action id rather than a method of its own.
 */
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

	async run(id: string, context: ActionContext): Promise<void> {
		const action = this._actions.get(id);
		if (!action) throw new Error(`no action "${id}"`);
		await action.run(context);
	}

	dispose(): void {
		this._actions.clear();
	}
}

export const ActionRegistryId = createServiceId<ActionRegistry>("ActionRegistry");
