import { createServiceId, type Service } from "@milu/di";
import type { ComponentType } from "react";

import type { Host, SurfaceProps } from "./surfaces.ts";

export interface ComposerTriggerProps extends SurfaceProps {
	readonly query: string;
	readonly items: readonly unknown[];
	readonly selectedIndex: number;
	readonly onHover: (index: number) => void;
	readonly onPick: (index: number) => void;
}

export interface ComposerTriggerComponent {
	readonly id: string;
	readonly trigger: string;
	readonly order?: number;
	readonly leading?: boolean;
	readonly component: ComponentType<ComposerTriggerProps>;
	readonly items: (host: Host, query: string) => readonly unknown[];
	readonly insert: (item: unknown) => string;
	readonly pick?: (host: Host, item: unknown, session: string) => boolean;
}

export class ComposerTriggerRegistry implements Service {
	private readonly _triggers = new Map<string, ComposerTriggerComponent>();

	constructor(triggers: readonly ComposerTriggerComponent[]) {
		for (const trigger of [...triggers].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))) {
			if (trigger.trigger.length !== 1) throw new Error(`composer trigger "${trigger.id}" must be one character`);
			if (this._triggers.has(trigger.trigger)) throw new Error(`composer trigger "${trigger.trigger}" is already contributed`);
			this._triggers.set(trigger.trigger, trigger);
		}
	}

	get(trigger: string): ComposerTriggerComponent | undefined {
		return this._triggers.get(trigger);
	}

	all(): readonly ComposerTriggerComponent[] {
		return [...this._triggers.values()];
	}

	dispose(): void {
		this._triggers.clear();
	}
}

export const ComposerTriggerRegistryId = createServiceId<ComposerTriggerRegistry>("ComposerTriggerRegistry");
