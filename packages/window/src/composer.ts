import { createServiceId, type Service } from "@milu/di";
import type { ComposerLayout, ComposerMode } from "@milu/protocol";
import type { ComponentType } from "react";
import { createStore } from "zustand/vanilla";

import { IActionsService } from "./actions.ts";
import type { ActionsService } from "./actions.ts";
import { IConnection } from "./connection.ts";
import type { Connection } from "./connection.ts";
import { IHotkeysService } from "./hotkeys.ts";
import type { ComposerKey, HotkeysService } from "./hotkeys.ts";
import { ISelectionService } from "./selection.ts";
import type { SelectionService } from "./selection.ts";
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
	readonly modeSession: string;
	readonly loaded: boolean;
}

export class ComposerService implements Service {
	readonly store = createStore<ComposerState>()(() => ({ layout: EMPTY, shellMode: false, modeSession: "", loaded: false }));

	private readonly _modes = new Map<string, ComposerMode>();
	private _layout: Promise<void> | null = null;

	constructor(
		@IConnection private readonly _connection: Connection,
		@IActionsService private readonly _actionsService: ActionsService,
		@IHotkeysService private readonly _hotkeysService: HotkeysService,
		@ISelectionService private readonly _selectionService: SelectionService,
	) {}

	async loadLayout(force = false): Promise<void> {
		if (!force && this.store.getState().loaded) return;
		if (this._layout) return this._layout;
		this._layout = this._connection
			.request("composer", {})
			.then(({ layout }) => this.store.setState((state) => ({ ...state, layout, loaded: true }), true))
			.catch(() => this.store.setState((state) => ({ ...state, layout: EMPTY, loaded: true }), true))
			.finally(() => {
				this._layout = null;
			});
		return this._layout;
	}

	async loadMode(session: string): Promise<void> {
		if (!session) {
			this.store.setState((state) => ({ ...state, shellMode: false, modeSession: "" }), true);
			return;
		}
		const cached = this._modes.get(session);
		if (cached) {
			if (this._selectionService.store.getState().selected === session) this._applyMode(session, cached);
			return;
		}
		try {
			const { mode } = await this._connection.request("composerMode", { session });
			this._modes.set(session, mode);
			if (this._selectionService.store.getState().selected === session) this._applyMode(session, mode);
		} catch {}
	}

	modeFor(session: string): ComposerMode {
		return this._modes.get(session) ?? "chat";
	}

	keydown(key: ComposerKey, state: ComposerKeyState): boolean {
		if (state.composing || key.isComposing) return false;
		const binding = this._hotkeysService.match(key, this.scopes(state));
		if (!binding) return false;
		void this._actionsService.invoke(binding.id, state.session);
		return true;
	}

	scopes(state: { readonly text: string; readonly session: string }): ReadonlySet<string> {
		const active = new Set<string>(["composer.focus"]);
		if (state.text.trim() === "") active.add("composer.empty");
		if (this.modeFor(state.session) === "shell") active.add("composer.shell");
		return active;
	}

	apply(session: string, mode: ComposerMode): void {
		this._modes.set(session, mode);
		if (this._selectionService.store.getState().selected !== session) return;
		this._applyMode(session, mode);
	}

	private _applyMode(session: string, mode: ComposerMode): void {
		this.store.setState((state) => ({ ...state, shellMode: mode === "shell", modeSession: session }), true);
	}

	dispose(): void {
		this._modes.clear();
		this._layout = null;
		this.store.setState({ layout: EMPTY, shellMode: false, modeSession: "", loaded: false }, true);
	}
}

export const WidgetRegistryId = createServiceId<WidgetRegistry>("WidgetRegistry");

export const IComposerService = createServiceId<ComposerService>("ComposerService");
