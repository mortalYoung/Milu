import type { Entry } from "@earendil-works/pi-agent-core";
import { createEffect, createSignal } from "solid-js";
import type { RPC } from "./rpc";

const PAGE_SIZE = 200;

/**
 * Frontend Origin session — the single loaded copy of the clean log (see
 * docs/2026-09-02-origin-slice-view-naming.md). View and Timeline are projected locally from
 * `entries` via the shared pure functions; there is exactly one load-more action.
 *
 * Paging contract: session_origin returns slices from the END (newest) backwards, each page in
 * chronological order. `entries` accumulates older pages in front (oldest → newest).
 */
export function createOriginSession(rpc: RPC, getSelectedName: () => string | null) {
	const [entries, setEntries] = createSignal<Entry[]>([]);
	const [signature, setSignature] = createSignal("");
	const [hasMore, setHasMore] = createSignal(false);
	const [total, setTotal] = createSignal(0);
	const [loading, setLoading] = createSignal(false);

	let lastLoaded = 0;

	function reset() {
		lastLoaded = 0;
		setEntries([]);
		setSignature("");
		setHasMore(false);
		setTotal(0);
	}

	function apply(res: Awaited<ReturnType<typeof rpc.request.session_origin>>, name: string) {
		if (getSelectedName() !== name) return;
		setEntries(res.entries);
		setSignature(res.signature);
		setHasMore(res.hasMore);
		setTotal(res.total);
		lastLoaded = res.loadedCount;
	}

	async function refresh() {
		const name = getSelectedName();
		if (!name) {
			reset();
			return;
		}
		setLoading(true);
		try {
			const res = await rpc.request.session_origin({ before: 0, limit: PAGE_SIZE });
			apply(res, name);
		} catch (error) {
			console.error("session_origin refresh failed:", error);
			throw error;
		} finally {
			setLoading(false);
		}
	}

	async function loadMore() {
		const name = getSelectedName();
		if (!name || loading() || !hasMore()) return;
		setLoading(true);
		try {
			const res = await rpc.request.session_origin({ before: lastLoaded, limit: PAGE_SIZE });
			if (getSelectedName() !== name) return;
			if (res.signature !== signature()) {
				// Origin changed underneath (new writes / rotation): restart from the newest page.
				setEntries(res.entries);
				setSignature(res.signature);
				setHasMore(res.hasMore);
				setTotal(res.total);
				lastLoaded = res.loadedCount;
				return;
			}
			const known = new Set(entries().map((e) => e.id));
			setEntries((prev) => [...res.entries.filter((e) => !known.has(e.id)), ...prev]);
			setHasMore(res.hasMore);
			setTotal(res.total);
			lastLoaded = res.loadedCount;
		} finally {
			setLoading(false);
		}
	}

	// Switching chats resets the shared Origin cache; re-open will refetch.
	let lastSeenName: string | null = null;
	createEffect(() => {
		const name = getSelectedName();
		if (name === lastSeenName) return;
		lastSeenName = name;
		reset();
	});

	return { entries, signature, hasMore, total, loading, refresh, loadMore };
}
