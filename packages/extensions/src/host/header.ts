import { createServiceId, type Service } from "@milu/di";
import type { ContributionItem } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

export class HeaderService implements Service {
	readonly store = createStore<{ items: readonly ContributionItem[] }>()(() => ({ items: [] }));

	apply(items: readonly ContributionItem[]): void {
		this.store.setState({ items }, true);
	}

	dispose(): void {}
}

export const HeaderServiceId = createServiceId<HeaderService>("HeaderService");
