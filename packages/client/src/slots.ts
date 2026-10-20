import { createServiceId, type Service } from "@milu/di";
import type { SlotItem } from "@milu/protocol";
import type { ComponentType } from "react";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";
import type { SurfaceProps } from "./surfaces.ts";

export interface SlotComponent {
	readonly id: string;
	readonly component: ComponentType<SurfaceProps>;
}

export class SlotsService implements Service {
	readonly state = new Store<Readonly<Record<string, readonly SlotItem[]>>>({});

	private readonly _components = new Map<string, ComponentType<SurfaceProps>>();

	constructor(
		private readonly _connection: Connection,
		components: readonly SlotComponent[],
	) {
		for (const { id, component } of components) this._components.set(id, component);
	}

	async load(points: readonly string[]): Promise<void> {
		const loaded = await Promise.all(points.map(async (point) => [point, (await this._connection.request("slots", { point })).items] as const));
		this.state.set(Object.fromEntries(loaded));
	}

	items(point: string): readonly SlotItem[] {
		return this.state.get()[point] ?? [];
	}

	component(id: string): ComponentType<SurfaceProps> | undefined {
		return this._components.get(id);
	}

	dispose(): void {
		this.state.dispose();
		this._components.clear();
	}
}

export const SlotsServiceId = createServiceId<SlotsService>("SlotsService");
