import { createServiceId, type Service } from "@milu/di";

import { Store } from "./store.ts";

export class WorkbenchService implements Service {
	readonly searchOpen = new Store(false);

	setSearch(open: boolean): void {
		this.searchOpen.set(open);
	}

	dispose(): void {
		this.searchOpen.dispose();
	}
}

export const WorkbenchServiceId = createServiceId<WorkbenchService>("WorkbenchService");
