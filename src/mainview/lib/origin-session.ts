import type { Entry } from "@earendil-works/pi-agent-core";
import { createEffect } from "solid-js";
import { createStore } from "solid-js/store";
import type { RPC } from "./rpc";

const PAGE_SIZE = 500;

interface OriginState {
	entries: Entry[];
	signature: string;
	hasMore: boolean;
	total: number;
	loading: boolean;
}

export function createOriginSession(rpc: RPC, getSelectedName: () => string | null) {
	const [state, setState] = createStore<OriginState>({
		entries: [],
		signature: "",
		hasMore: false,
		total: 0,
		loading: false,
	});

	const entries = () => state.entries;
	const signature = () => state.signature;
	const hasMore = () => state.hasMore;
	const total = () => state.total;
	const loading = () => state.loading;

	let lastLoaded = 0;

	let refreshPromise: { name: string | null; promise: Promise<void> } | null = null;

	function reset() {
		lastLoaded = 0;
		setState({
			entries: [],
			signature: "",
			hasMore: false,
			total: 0,
			loading: false,
		});
	}

	function refresh(): Promise<void> {
		const name = getSelectedName();

		if (refreshPromise && refreshPromise.name === name) return refreshPromise.promise;
		const promise = performRefresh();
		refreshPromise = { name, promise };
		return promise;
	}

	async function performRefresh() {
		const name = getSelectedName();
		if (!name) {
			reset();
			refreshPromise = null;
			return;
		}
		setState("loading", true);
		try {
			const res = await rpc.request.session_origin({ before: 0, limit: PAGE_SIZE });
			if (getSelectedName() !== name) return;

			const prev = state.entries;
			const newIds = new Set(res.entries.map((e) => e.id));
			const overlap = prev.some((e) => newIds.has(e.id));
			let next = res.entries;
			let loaded = res.loadedCount;
			if (prev.length > 0 && res.total > 0 && (overlap || res.total >= prev.length)) {
				const older = prev.filter((e) => !newIds.has(e.id));
				next = [...older, ...res.entries];
				loaded = Math.min(res.total, older.length + res.loadedCount);
			}
			setState({
				entries: next,
				signature: res.signature,
				hasMore: loaded < res.total,
				total: res.total,
			});
			lastLoaded = loaded;
		} catch (error) {
			console.error("session_origin refresh failed:", error);
			throw error;
		} finally {
			setState("loading", false);

			if (refreshPromise?.name === name) refreshPromise = null;
		}
	}

	async function loadMore() {
		const name = getSelectedName();
		if (!name || loading() || !hasMore()) return;
		setState("loading", true);
		try {
			const res = await rpc.request.session_origin({ before: lastLoaded, limit: PAGE_SIZE });
			if (getSelectedName() !== name) return;
			if (res.signature !== signature()) {
				setState({
					entries: res.entries,
					signature: res.signature,
					hasMore: res.hasMore,
					total: res.total,
				});
				lastLoaded = res.loadedCount;
				return;
			}
			const known = new Set(state.entries.map((e) => e.id));
			const next = [...res.entries.filter((e) => !known.has(e.id)), ...state.entries];
			setState({
				entries: next,
				hasMore: res.hasMore,
				total: res.total,
			});
			lastLoaded = res.loadedCount;
		} finally {
			setState("loading", false);
		}
	}

	let lastSeenName: string | null = null;
	createEffect(() => {
		const name = getSelectedName();
		if (name === lastSeenName) return;
		lastSeenName = name;
		reset();
	});

	return { entries, signature, hasMore, total, loading, refresh, loadMore };
}
