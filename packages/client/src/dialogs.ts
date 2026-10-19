import { createServiceId, type Service } from "@milu/di";
import type { ConfirmCopy, DialogDescriptor } from "@milu/protocol";
import type { ComponentType } from "react";

import { Store } from "./store.ts";
import type { Host } from "./surfaces.ts";

export interface DialogProps {
	readonly host: Host;
	readonly close: (value: unknown) => void;
}

export interface DialogComponent {
	readonly id: string;
	readonly component: ComponentType<DialogProps>;
}

export interface PendingDialog {
	readonly dialog: DialogDescriptor;
	readonly requestId: string;
	readonly settle: (value: unknown) => void;
}

export class DialogService implements Service {
	readonly pending = new Store<PendingDialog | null>(null);

	private readonly _components = new Map<string, ComponentType<DialogProps>>();

	constructor(components: readonly DialogComponent[]) {
		for (const { id, component } of components) this._components.set(id, component);
	}

	get(id: string): ComponentType<DialogProps> | undefined {
		return this._components.get(id);
	}

	ask(requestId: string, dialog: DialogDescriptor): Promise<unknown> {
		return new Promise((settle) => {
			this.pending.set({ dialog, requestId, settle });
		});
	}

	confirm(copy: ConfirmCopy): Promise<boolean> {
		return this.ask("confirm", { kind: "confirm", copy }).then((value) => value === true);
	}

	resolve(value: unknown): void {
		const current = this.pending.get();
		this.pending.set(null);
		current?.settle(value);
	}

	dispose(): void {
		this.pending.dispose();
		this._components.clear();
	}
}

export const DialogServiceId = createServiceId<DialogService>("DialogService");
