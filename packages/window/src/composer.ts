import { createServiceId, type Service } from "@milu/di";
import type { ComposerLayout } from "@milu/protocol";
import type { ComponentType } from "react";
import { createStore } from "zustand/vanilla";

import { IActionsService } from "./actions.ts";
import type { ActionsService } from "./actions.ts";
import { IConnection } from "./connection.ts";
import type { Connection } from "./connection.ts";
import { IHotkeysService } from "./hotkeys.ts";
import type { ComposerKey, HotkeysService } from "./hotkeys.ts";
import type { Host } from "./surfaces.ts";

export interface WidgetProps {
	readonly host: Host;
	readonly data: unknown;
}

export interface WidgetComponent {
	readonly id: string;
	readonly component: ComponentType<WidgetProps>;
}

export interface ComposerKeyState {
	readonly session: string;
	readonly text: string;
	readonly composing: boolean;
}

const EMPTY: ComposerLayout = { left: [], right: [], tips: [] };

export class WidgetRegistry implements Service {
	private readonly _widgets = new Map<string, ComponentType<WidgetProps>>();

	constructor(widgets: readonly WidgetComponent[]) {
		for (const { id, component } of widgets) this._widgets.set(id, component);
	}

	get(id: string): ComponentType<WidgetProps> | undefined {
		return this._widgets.get(id);
	}

	dispose(): void {
		this._widgets.clear();
	}
}

export interface ComposerState {
	readonly layout: ComposerLayout;
	readonly shellMode: boolean;
}

export class ComposerService implements Service {
	readonly store = createStore<ComposerState>()(() => ({ layout: EMPTY, shellMode: false }));

	constructor(
		@IConnection private readonly _connection: Connection,
		@IActionsService private readonly _actionsService: ActionsService,
		@IHotkeysService private readonly _hotkeysService: HotkeysService,
	) {}

	async load(session: string): Promise<void> {
		if (!session) {
			this.store.setState((state) => ({ ...state, layout: EMPTY }), true);
			return;
		}
		try {
			const layout = await this._connection.request("composer", { session });
			this.store.setState((state) => ({ ...state, layout }), true);
		} catch {
			this.store.setState((state) => ({ ...state, layout: EMPTY }), true);
		}
	}

	keydown(key: ComposerKey, state: ComposerKeyState): boolean {
		if (state.composing || key.isComposing) return false;
		const binding = this._hotkeysService.match(key, this.scopes(state));
		if (!binding) return false;
		void this._actionsService.invoke(binding.id, state.session);
		return true;
	}

	scopes(state: { readonly text: string }): ReadonlySet<string> {
		const active = new Set<string>(["composer.focus"]);
		if (state.text.trim() === "") active.add("composer.empty");
		if (this.store.getState().shellMode) active.add("composer.shell");
		return active;
	}

	setShell(on: boolean): void {
		if (this.store.getState().shellMode === on) return;
		this.store.setState((state) => ({ ...state, shellMode: on }), true);
	}

	toggleShell(): void {
		this.store.setState((state) => ({ ...state, shellMode: !state.shellMode }), true);
	}

	dispose(): void {}
}

export const WidgetRegistryId = createServiceId<WidgetRegistry>("WidgetRegistry");

export const IComposerService = createServiceId<ComposerService>("ComposerService");
