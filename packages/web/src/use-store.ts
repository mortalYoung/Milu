import type { Store } from "@milu/client";
import { useSyncExternalStore } from "react";

/** The one bridge from a store to a render: read the snapshot, subscribe to the rest. */
export function useStore<T>(store: Store<T>): T {
	return useSyncExternalStore(store.subscribe, store.get, store.get);
}
