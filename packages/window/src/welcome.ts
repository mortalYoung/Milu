import { createServiceId, type Service } from "@milu/di";
import type { WelcomeItem } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

export class WelcomeService implements Service {
	readonly store = createStore<{ items: readonly WelcomeItem[] }>()(() => ({ items: [] }));

	apply(items: readonly WelcomeItem[]): void {
		this.store.setState({ items }, true);
	}

	dispose(): void {}
}

export const IWelcomeService = createServiceId<WelcomeService>("WelcomeService");
