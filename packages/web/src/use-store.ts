import type { Store } from "@milu/client";
import { useCallback, useRef, useSyncExternalStore } from "react";

interface Cache<T, S> {
	readonly selector: ((value: T) => S) | undefined;
	readonly value: T;
	readonly result: S;
}

export function useStore<T>(store: Store<T>): T;
export function useStore<T, S>(store: Store<T>, selector: (value: T) => S): S;
export function useStore<T, S>(store: Store<T>, selector?: (value: T) => S): T | S {
	const cache = useRef<Cache<T, S> | null>(null);
	const read = useCallback(() => {
		const value = store.get();
		const known = cache.current;
		if (known && known.selector === selector && Object.is(known.value, value)) return known.result;
		const result = selector ? selector(value) : (value as unknown as S);
		cache.current = { selector, value, result };
		return result;
	}, [store, selector]);
	return useSyncExternalStore(store.subscribe, read, read);
}
