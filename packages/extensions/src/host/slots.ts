import { createServiceId, type Service } from "@milu/di";
import type { SlotItem } from "@milu/protocol";
import type { ComponentType } from "react";
import { createStore } from "zustand/vanilla";

import type { SurfaceProps } from "./surfaces.ts";

export interface SlotsState {
	readonly points: Readonly<Record<string, readonly SlotItem[]>>;
}

export interface SlotComponent {
	readonly id: string;
	readonly component: ComponentType<SurfaceProps>;
}

export class SlotsService implements Service {
	readonly store = createStore<SlotsState>()(() => ({ points: {} }));

	private readonly _components = new Map<string, ComponentType<SurfaceProps>>();

	constructor(components: readonly SlotComponent[]) {
		for (const { id, component } of components) this._components.set(id, component);
	}

	apply(points: Readonly<Record<string, readonly SlotItem[]>>): void {
		this.store.setState({ points }, true);
	}

	component(id: string): ComponentType<SurfaceProps> | undefined {
		return this._components.get(id);
	}

	dispose(): void {
		this._components.clear();
	}
}

export const SlotsServiceId = createServiceId<SlotsService>("SlotsService");
