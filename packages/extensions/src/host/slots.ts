import { createServiceId, type Service } from "@milu/di";
import type { SlotItem } from "@milu/protocol";
import type { ComponentType } from "react";
import { createStore } from "zustand/vanilla";

import type { Connection } from "./connection.ts";
import type { SurfaceProps } from "./surfaces.ts";

export interface SlotsState {
	readonly points: Readonly<Record<string, readonly SlotItem[]>>;
}

export interface SlotProps extends SurfaceProps {
	readonly data?: unknown;
}

export interface SlotComponent {
	readonly id: string;
	readonly component: ComponentType<SlotProps>;
}

export class SlotsService implements Service {
	readonly store = createStore<SlotsState>()(() => ({ points: {} }));

	private readonly _components = new Map<string, ComponentType<SlotProps>>();
	private readonly _connection: Connection;

	constructor(connection: Connection, components: readonly SlotComponent[]) {
		this._connection = connection;
		for (const { id, component } of components) this._components.set(id, component);
	}

	async load(point: string, session?: string): Promise<void> {
		const { items } = await this._connection.request("slots", { point, ...(session ? { session } : {}) });
		this.store.setState((state) => ({ points: { ...state.points, [point]: items } }), true);
	}

	apply(points: Readonly<Record<string, readonly SlotItem[]>>): void {
		this.store.setState({ points }, true);
	}

	component(id: string): ComponentType<SlotProps> | undefined {
		return this._components.get(id);
	}

	dispose(): void {
		this._components.clear();
	}
}

export const SlotsServiceId = createServiceId<SlotsService>("SlotsService");
