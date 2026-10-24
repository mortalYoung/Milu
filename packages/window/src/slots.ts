import { createServiceId, type Service } from "@milu/di";
import type { SlotItem } from "@milu/protocol";
import type { ComponentType } from "react";
import { createStore } from "zustand/vanilla";

import { type Connection, IConnection } from "./connection.ts";
import type { SurfaceProps } from "./surfaces.ts";

export interface SlotsState {
	readonly points: Readonly<Record<string, readonly SlotItem[]>>;
	readonly components: ReadonlyMap<string, ComponentType<SlotProps>>;
}

export interface SlotProps extends SurfaceProps {
	readonly data?: unknown;
}

export interface SlotComponent {
	readonly id: string;
	readonly component: ComponentType<SlotProps>;
}

export class SlotsService implements Service {
	readonly store = createStore<SlotsState>()(() => ({ points: {}, components: new Map() }));

	constructor(
		@IConnection private readonly _connection: Connection,
		components: readonly SlotComponent[],
	) {
		for (const { id, component } of components) this.register(id, component);
	}

	async load(point: string, session?: string): Promise<void> {
		const { items } = await this._connection.request("slots", { point, ...(session ? { session } : {}) });
		this.store.setState((state) => ({ ...state, points: { ...state.points, [point]: items } }), true);
	}

	apply(points: Readonly<Record<string, readonly SlotItem[]>>): void {
		this.store.setState((state) => ({ ...state, points }), true);
	}

	register(id: string, component: ComponentType<SlotProps>): void {
		if (this.store.getState().components.has(id)) throw new Error(`slot component "${id}" is already registered`);
		this.store.setState((state) => ({ ...state, components: new Map(state.components).set(id, component) }), true);
	}

	dispose(): void {
		this.store.setState({ points: {}, components: new Map() }, true);
	}
}

export const ISlotsService = createServiceId<SlotsService>("SlotsService");
