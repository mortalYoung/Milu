import { createServiceId, type Service } from "@milu/di";
import type { ComposerLayout } from "@milu/protocol";
import type { ComponentType } from "react";

import type { ActionsService } from "./actions.ts";
import type { Connection } from "./connection.ts";
import type { ComposerKey, HotkeysService } from "./hotkeys.ts";
import { Store } from "./store.ts";
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

export class ComposerService implements Service {
	readonly layout = new Store<ComposerLayout>({ left: [], right: [], tips: [] });
	readonly shellMode = new Store(false);

	constructor(
		private readonly _connection: Connection,
		private readonly _actionsService: ActionsService,
		private readonly _hotkeysService: HotkeysService,
	) {}

	async load(session: string): Promise<void> {
		if (!session) {
			this.layout.set({ left: [], right: [], tips: [] });
			return;
		}
		try {
			this.layout.set(await this._connection.request("composer", { session }));
		} catch {
			this.layout.set({ left: [], right: [], tips: [] });
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
		if (this.shellMode.get()) active.add("composer.shell");
		return active;
	}

	setShell(on: boolean): void {
		this.shellMode.set(on);
	}

	toggleShell(): void {
		this.shellMode.set(!this.shellMode.get());
	}

	dispose(): void {
		this.layout.dispose();
		this.shellMode.dispose();
	}
}

export const WidgetRegistryId = createServiceId<WidgetRegistry>("WidgetRegistry");

export const ComposerServiceId = createServiceId<ComposerService>("ComposerService");
