import { createServiceId, type Service } from "@milu/di";
import type { LayoutState } from "@milu/protocol";
import type { ComponentType } from "react";

import type { ActionsService } from "./actions.ts";
import type { Connection } from "./connection.ts";
import type { OpenerService } from "./opener.ts";
import type { SessionListService } from "./sessions.ts";
import type { Store } from "./store.ts";
import type { TranscriptService } from "./transcripts.ts";
import type { WorkbenchService } from "./workbench.ts";

/** What a surface is handed: the services, and nothing about who composed them. */
export interface SurfaceProps {
	readonly host: Host;
}

/** A surface as this bundle can render it — the id the core declared, and the code for it. */
export interface SurfaceComponent {
	readonly id: string;
	readonly component: ComponentType<SurfaceProps>;
}

export interface Host {
	readonly connection: Connection;
	readonly sessions: SessionListService;
	readonly transcript: TranscriptService;
	readonly workbench: WorkbenchService;
	readonly opener: OpenerService;
	readonly actions: ActionsService;
	readonly surfaces: SurfaceRegistry;
	/** The core's answer, as it last arrived. State, not a service: this side never decides. */
	readonly layoutState: Store<LayoutState>;
}

/**
 * The code this bundle brought, by id. What *exists* on the page is the core's answer — this only
 * resolves the ids it is handed, so an extension's surface and a core surface arrive the same way.
 */
export class SurfaceRegistry implements Service {
	private readonly _components = new Map<string, ComponentType<SurfaceProps>>();

	constructor(components: readonly SurfaceComponent[]) {
		for (const { id, component } of components) this.register(id, component);
	}

	register(id: string, component: ComponentType<SurfaceProps>): void {
		if (this._components.has(id)) throw new Error(`surface "${id}" is already registered`);
		this._components.set(id, component);
	}

	get(id: string): ComponentType<SurfaceProps> | undefined {
		return this._components.get(id);
	}

	dispose(): void {
		this._components.clear();
	}
}

export const SurfaceRegistryId = createServiceId<SurfaceRegistry>("SurfaceRegistry");
