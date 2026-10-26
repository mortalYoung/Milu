import { createServiceId, type Service } from "@milu/di";
import type { ComponentType } from "react";

import type { SlotProps } from "./slots.ts";

export interface RowComponent {
	readonly id: string;
	readonly component: ComponentType<SlotProps>;
}

/** Row renderers by view kind (`tool`, `thinking`, `say`), so an extension can own how a kind looks. */
export class RowRegistry implements Service {
	private readonly _rows = new Map<string, ComponentType<SlotProps>>();

	constructor(rows: readonly RowComponent[]) {
		for (const { id, component } of rows) this._rows.set(id, component);
	}

	get(kind: string): ComponentType<SlotProps> | undefined {
		return this._rows.get(kind);
	}

	dispose(): void {
		this._rows.clear();
	}
}

export const RowRegistryId = createServiceId<RowRegistry>("RowRegistry");
