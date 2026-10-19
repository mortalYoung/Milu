import { createServiceId, type Service } from "@milu/di";

import { Store } from "./store.ts";
import type { Surface, SurfaceRegistry } from "./surfaces.ts";

/** slot → surface ids, in the order the shell renders them. */
export type Layout = Readonly<Record<string, readonly string[]>>;

/**
 * Where each surface sits. Seeded from what the registry declares, then owned here alone — so
 * reordering, hiding, and (next) persisting never touch a surface or the shell.
 */
export class LayoutService implements Service {
	readonly layout = new Store<Layout>({});

	constructor(private readonly _surfaces: SurfaceRegistry) {}

	initialize(): void {
		this.reset();
	}

	/** A fresh layout: every slot filled with what was declared for it. */
	reset(): void {
		const next: Record<string, string[]> = {};
		for (const slot of this._surfaces.slots()) next[slot] = this._surfaces.declared(slot).map((surface) => surface.id);
		this.layout.set(next);
	}

	ids(slot: string): readonly string[] {
		return this.layout.get()[slot] ?? [];
	}

	/** The surfaces of one slot, resolved — what the shell actually mounts. */
	surfaces(slot: string): readonly Surface[] {
		return this.ids(slot)
			.map((id) => this._surfaces.get(id))
			.filter((surface): surface is Surface => surface !== undefined);
	}

	setSlot(slot: string, ids: readonly string[]): void {
		this.layout.update((current) => ({ ...current, [slot]: [...ids] }));
	}

	dispose(): void {
		this.layout.dispose();
	}
}

export const LayoutServiceId = createServiceId<LayoutService>("LayoutService");
