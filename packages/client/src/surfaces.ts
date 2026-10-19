import { createServiceId, type Service } from "@milu/di";
import type { ComponentType } from "react";

import type { ChatsService } from "./chats.ts";
import type { Connection } from "./connection.ts";
import type { LayoutService } from "./layout.ts";
import type { SessionsService } from "./sessions.ts";
import type { ShellService } from "./shell.ts";

/** What a surface is handed: the services, and nothing about who composed them. */
export interface SurfaceProps {
	readonly host: Host;
}

/**
 * A piece of the page, addressed by id. The core's own pieces come through this door too — if the
 * chat list can be mounted as a surface, an extension's surface will mount the same way.
 */
export interface Surface {
	readonly id: string;
	readonly slot: string;
	readonly order?: number;
	readonly component: ComponentType<SurfaceProps>;
}

export interface Host {
	readonly connection: Connection;
	readonly chats: ChatsService;
	readonly sessions: SessionsService;
	readonly shell: ShellService;
	readonly surfaces: SurfaceRegistry;
	readonly layout: LayoutService;
}

/** Everything that exists. Where it is placed is the layout's business, not the registry's. */
export class SurfaceRegistry implements Service {
	private readonly _surfaces = new Map<string, Surface>();

	constructor(surfaces: readonly Surface[]) {
		for (const surface of surfaces) this.register(surface);
	}

	register(surface: Surface): void {
		if (this._surfaces.has(surface.id)) throw new Error(`surface "${surface.id}" is already registered`);
		this._surfaces.set(surface.id, surface);
	}

	unregister(id: string): void {
		this._surfaces.delete(id);
	}

	get(id: string): Surface | undefined {
		return this._surfaces.get(id);
	}

	/** Every surface of a slot, in the order they were declared — the seed for a fresh layout. */
	declared(slot: string): readonly Surface[] {
		return [...this._surfaces.values()].filter((surface) => surface.slot === slot).sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
	}

	slots(): readonly string[] {
		return [...new Set([...this._surfaces.values()].map((surface) => surface.slot))];
	}

	dispose(): void {
		this._surfaces.clear();
	}
}

export const SurfaceRegistryId = createServiceId<SurfaceRegistry>("SurfaceRegistry");
