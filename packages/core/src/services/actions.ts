import { createServiceId, type Disposable, type Service } from "@milu/di";
import type { BrowserCommand, ConfirmCopy, DialogDescriptor, Hotkey } from "@milu/protocol";

import type { Session } from "../session/session.ts";
import type { SessionService } from "./sessions.ts";

export interface ActionContext {
	readonly session?: Session;
	readonly args?: unknown;
	readonly sessions?: SessionService;
	readonly dialog?: (dialog: DialogDescriptor) => Promise<unknown>;
}

export type ActionOutcome = void | BrowserCommand | { readonly data: unknown };

export interface Action {
	readonly id: string;
	readonly scope?: string | readonly string[];
	readonly hotkey?: Hotkey;
	readonly confirm?: (context: ActionContext) => ConfirmCopy | null | Promise<ConfirmCopy | null>;
	readonly run: (context: ActionContext) => ActionOutcome | Promise<ActionOutcome>;
}

export interface ActionBinding {
	readonly id: string;
	readonly hotkey: Hotkey;
	readonly scopes: readonly string[];
}

export class ActionService implements Service {
	private readonly _actions = new Map<string, Action>();

	register(action: Action): Disposable {
		if (this._actions.has(action.id)) throw new Error(`action "${action.id}" is already registered`);
		if (action.hotkey !== undefined && action.scope === undefined) throw new Error(`action "${action.id}" binds "${action.hotkey}" without a scope`);
		this._actions.set(action.id, action);
		return {
			dispose: () => {
				this._actions.delete(action.id);
			},
		};
	}

	bindings(): readonly ActionBinding[] {
		const bound: ActionBinding[] = [];
		for (const action of this._actions.values()) {
			if (action.hotkey === undefined || action.scope === undefined) continue;
			bound.push({ id: action.id, hotkey: action.hotkey, scopes: typeof action.scope === "string" ? [action.scope] : [...action.scope] });
		}
		return bound.sort((left, right) => left.id.localeCompare(right.id));
	}

	async confirm(id: string, context: ActionContext): Promise<ConfirmCopy | null> {
		return (await this._action(id).confirm?.(context)) ?? null;
	}

	async run(id: string, context: ActionContext): Promise<ActionOutcome> {
		return this._action(id).run(context);
	}

	dispose(): void {
		this._actions.clear();
	}

	private _action(id: string): Action {
		const action = this._actions.get(id);
		if (!action) throw new Error(`no action "${id}"`);
		return action;
	}
}

export const ActionServiceId = createServiceId<ActionService>("ActionService");
