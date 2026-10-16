import type { Entry as OriginEntry } from "@earendil-works/pi-agent-core";
import { createStore } from "zustand/vanilla";
import type { ChatPreviewKind } from "../../shared/rpc";
import { createInFlightBoolean } from "./inflight";
import type { RPC } from "./rpc";

export interface PartnerItem {
	name: string;
	persona?: string;
	createdAt: number;
	path: string;
	forkedFrom?: string;
	lastMessage?: string;
	lastMessageAt?: number;
	startedAt?: number;
	lastMessageKind?: ChatPreviewKind;
	readAt?: number;
	workspace?: string | null;
	/** Where this chat keeps its files (the agent's own scratch area). */
	storage?: string | null;
	/** What the workspace is: a linked worktree, a repo checkout, or a plain directory. */
	workspaceKind?: "worktree" | "repo" | "dir" | null;
	workspaceRepo?: string | null;
	pinned?: boolean;
	writing?: boolean;
}

export interface OriginData {
	entries: OriginEntry[];
	hasMore: boolean;
	total: number;
	loading: boolean;
	baseDir: string | null;
}

export interface SessionData {
	selected: string | null;
	partners: PartnerItem[];
	origin: OriginData;
}

const EMPTY_ORIGIN: OriginData = { entries: [], hasMore: false, total: 0, loading: false, baseDir: null };

export type Session = ReturnType<typeof createSession>;

export function createSession(rpc: RPC) {
	const store = createStore<SessionData>()(() => ({ selected: null, partners: [], origin: EMPTY_ORIGIN }));
	let resumeChecked = false;
	const historyLoading = createInFlightBoolean();
	const partnersLoading = createInFlightBoolean();

	const get = store.getState;
	const patchOrigin = (patch: Partial<OriginData>) => store.setState({ origin: { ...get().origin, ...patch } });

	let refreshPromise: { name: string | null; promise: Promise<void> } | null = null;
	let partnersRefreshSeq = 0;

	function resetOrigin() {
		store.setState({ origin: EMPTY_ORIGIN });
	}

	async function performRefresh(name: string | null) {
		if (!name) {
			resetOrigin();
			refreshPromise = null;
			return;
		}
		patchOrigin({ loading: true });
		try {
			if (get().selected !== name) return;
			const existing = get().origin.entries;
			const res = existing.length === 0 ? await rpc.request.session_origin({ name }) : await rpc.request.session_origin({ name, mode: "newer", cursor: existing.at(-1)!.id });
			if (res.reset || existing.length === 0) {
				patchOrigin({ entries: res.entries, hasMore: res.hasMore, total: res.total, baseDir: res.baseDir });
				return;
			}
			const newIds = new Set(res.entries.map((e) => e.id));
			const older = existing.filter((e) => !newIds.has(e.id));
			patchOrigin({ entries: [...older, ...res.entries], hasMore: get().origin.hasMore, total: res.total, baseDir: res.baseDir });
		} catch (error) {
			console.error("session_origin refresh failed:", error);
			throw error;
		} finally {
			patchOrigin({ loading: false });
			if (refreshPromise?.name === name) refreshPromise = null;
		}
	}

	function refresh(nameArg?: string | null): Promise<void> {
		const name = nameArg ?? get().selected;
		if (refreshPromise && refreshPromise.name === name) return refreshPromise.promise;
		const promise = performRefresh(name);
		refreshPromise = { name, promise };
		return promise;
	}

	async function loadMore() {
		const name = get().selected;
		if (!name || get().origin.loading || !get().origin.hasMore) return;
		const oldest = get().origin.entries[0]?.id;
		if (!oldest) return;
		patchOrigin({ loading: true });
		try {
			const res = await rpc.request.session_origin({ name, mode: "older", cursor: oldest });
			if (get().selected !== name) return;
			if (res.reset) {
				patchOrigin({ entries: res.entries, hasMore: res.hasMore, total: res.total, baseDir: res.baseDir });
				return;
			}
			const known = new Set(get().origin.entries.map((e) => e.id));
			const next = [...res.entries.filter((e) => !known.has(e.id)), ...get().origin.entries];
			patchOrigin({ entries: next, hasMore: res.hasMore, total: res.total, baseDir: res.baseDir });
		} finally {
			patchOrigin({ loading: false });
		}
	}

	async function refreshHistory() {
		historyLoading.begin();
		try {
			await refresh();
		} finally {
			historyLoading.end();
		}
	}

	async function loadOlderHistory(): Promise<boolean> {
		if (!get().origin.hasMore) return false;
		const name = get().selected;
		historyLoading.begin();
		try {
			const before = get().origin.entries.length;
			await loadMore();
			if (get().selected !== name) return false;
			return get().origin.entries.length !== before;
		} finally {
			historyLoading.end();
		}
	}

	async function refreshPartners() {
		const seq = ++partnersRefreshSeq;
		partnersLoading.begin();
		try {
			const { partners: list } = await rpc.request.list_partners({});
			if (seq !== partnersRefreshSeq) return;
			store.setState({ partners: list });
			if (get().selected != null && !list.some((p) => p.name === get().selected)) select(null);
			else void reopenLastChat(list);
		} finally {
			partnersLoading.end();
		}
	}

	async function reopenLastChat(list: PartnerItem[]) {
		if (resumeChecked) return;
		resumeChecked = true;
		const { partner: name } = await rpc.request.last_partner({});
		if (name === null || get().selected != null) return;
		const partner = list.find((p) => p.name === name);
		if (partner) select(partner);
	}

	function select(partner: PartnerItem | null) {
		const next = partner?.name ?? null;
		if (next !== get().selected) resetOrigin();
		store.setState({ selected: next });

		const profile = partner ? { name: partner.name, persona: partner.persona } : null;
		historyLoading.begin();
		void Promise.all([rpc.request.set_partner({ profile }), partner ? refresh(partner.name) : Promise.resolve()])
			.catch(() => {})
			.finally(() => {
				historyLoading.end();
			});
	}

	function patchPartner(name: string, patch: Partial<PartnerItem>) {
		store.setState((state) => ({ partners: state.partners.map((partner) => (partner.name === name ? { ...partner, ...patch } : partner)) }));
	}

	return {
		store,
		historyLoading,
		partnersLoading,
		mutate: {
			refreshHistory,
			loadOlderHistory,
			refreshPartners,
			patchPartner,
			select,
			originRefresh: refresh,
			originLoadMore: loadMore,
		},
	};
}
