import { createServiceId, type Service } from "@milu/di";
import type { ActionBinding } from "@milu/protocol";

import type { Connection } from "./connection.ts";
import { Store } from "./store.ts";

export interface ComposerKey {
	readonly key: string;
	readonly shift: boolean;
	readonly meta: boolean;
	readonly ctrl: boolean;
	readonly alt: boolean;
	readonly isComposing: boolean;
}

export class HotkeysService implements Service {
	readonly bindings = new Store<readonly ActionBinding[]>([]);

	constructor(private readonly _connection: Connection) {}

	async load(): Promise<void> {
		this.bindings.set((await this._connection.request("hotkeys", {})).bindings);
	}

	match(key: ComposerKey, active: ReadonlySet<string>): ActionBinding | null {
		if (key.meta || key.ctrl || key.alt) return null;
		for (const binding of this.bindings.get()) {
			if (binding.hotkey !== key.key) continue;
			if (!binding.scopes.every((scope) => active.has(scope))) continue;
			return binding;
		}
		return null;
	}

	dispose(): void {
		this.bindings.dispose();
	}
}

export const HotkeysServiceId = createServiceId<HotkeysService>("HotkeysService");
