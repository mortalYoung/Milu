import type { Store } from "@milu/client";
import { useSyncExternalStore } from "react";

export function useStore<T>(store: Store<T>): T {
	return useSyncExternalStore(store.subscribe, store.get, store.get);
}
