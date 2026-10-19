import { createServiceId, type Service } from "@milu/di";

import { Store } from "./store.ts";

/** The frame around the surfaces: what is open, and which of them the keyboard is talking to. */
export class ShellService implements Service {
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

export const ShellServiceId = createServiceId<ShellService>("ShellService");
