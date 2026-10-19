import { createServiceId, type Service } from "@milu/di";

import { Store } from "./store.ts";

/** The workbench's own switches: which panes are open, where the keyboard is aimed. */
export class WorkbenchService implements Service {
	readonly listOpen = new Store(true);
	readonly searchOpen = new Store(false);

	toggleList(): void {
		this.listOpen.update((open) => !open);
	}

	setList(open: boolean): void {
		this.listOpen.set(open);
	}

	setSearch(open: boolean): void {
		this.searchOpen.set(open);
	}

	dispose(): void {
		this.listOpen.dispose();
		this.searchOpen.dispose();
	}
}

export const WorkbenchServiceId = createServiceId<WorkbenchService>("WorkbenchService");
