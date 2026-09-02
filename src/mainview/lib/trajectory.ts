import { createEffect, createSignal } from "solid-js";
import { projectVisibleHistory } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { surfaceNodeIds } from "../../shared/slice";
import { fold } from "../../shared/timeline";
import type { createOriginSession } from "./origin-session";
import type { RPC } from "./rpc";

const PAGE_SIZE = 200;
type OriginSession = ReturnType<typeof createOriginSession>;

export type TrajectoryMode = "origin" | "slice" | "view";

export function createTrajectory(rpc: RPC, getSelectedName: () => string | null, origin?: OriginSession) {
	const [open, setOpen] = createSignal(false);
	const [records, setRecords] = createSignal<TrajectoryRecord[]>([]);
	const [total, setTotal] = createSignal(0);
	const [mode, setMode] = createSignal<TrajectoryMode>("origin");
	const [loading, setLoading] = createSignal(false);
	const [hasMore, setHasMore] = createSignal(false);
	const [loadingOlder, setLoadingOlder] = createSignal(false);
	const [flashId, setFlashId] = createSignal<number | null>(null);

	let cache: { name: string | null; mode: TrajectoryMode; records: TrajectoryRecord[]; hasMore: boolean; total: number } | null = null;
	let originStale = false;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	function rebuildFromOrigin() {
		if (!origin) return;
		const entries = origin.entries();
		const all = fold(entries);
		let next = all;
		if (mode() === "slice") {
			const sliceIds = surfaceNodeIds(entries);
			next = all.filter((r) => sliceIds.has(r.entryId));
		} else if (mode() === "view") {
			const viewIds = new Set(projectVisibleHistory(entries).map((v) => v.id));
			next = all.filter((r) => viewIds.has(r.entryId));
		}
		setRecords(next);
		setHasMore(origin.hasMore());
		setTotal(origin.total());
	}

	async function view() {
		const name = getSelectedName();
		if (!name) return;
		setLoading(true);
		let ready = false;
		try {
			if (origin) {
				try {
					if (origin.entries().length === 0 || originStale) {
						await origin.refresh();
						originStale = false;
					}
					if (getSelectedName() !== name) return;
					rebuildFromOrigin();
					ready = true;
				} catch (error) {
					console.error("origin refresh failed, falling back to remote trajectory:", error);
				}
			}
			if (!ready) {
				const surfaceOnly = mode() === "slice";
				if (cache === null || cache.name !== name || cache.mode !== mode()) {
					const res = await rpc.request.trajectory({ name, limit: PAGE_SIZE, surfaceOnly });
					if (getSelectedName() !== name) return;
					cache = { name, mode: mode(), records: res.records, hasMore: res.hasMore, total: res.total };
					setRecords(cache.records);
					setHasMore(res.hasMore);
					setTotal(res.total);
				} else {
					setRecords(cache.records);
					setHasMore(cache.hasMore);
					setTotal(cache.total);
				}
			}
		} catch {
		} finally {
			setLoading(false);
		}
		if (getSelectedName() === name) setOpen(true);
	}

	async function loadOlder() {
		const name = getSelectedName();
		if (!name || loadingOlder() || !hasMore()) return;
		if (origin) {
			setLoadingOlder(true);
			try {
				await origin.loadMore();
				if (getSelectedName() !== name) return;
				rebuildFromOrigin();
			} finally {
				setLoadingOlder(false);
			}
			return;
		}
		const before = records()[0]?.seq;
		if (before == null) return;
		setLoadingOlder(true);
		try {
			const res = await rpc.request.trajectory({ name, before, limit: PAGE_SIZE, surfaceOnly: mode() === "slice" });
			if (getSelectedName() !== name) return;
			setRecords((prev) => [...res.records.filter((r) => r.seq < before), ...prev]);
			setHasMore(res.hasMore);
			setTotal(res.total);
			if (cache) cache = { ...cache, records: [...res.records.filter((r) => r.seq < before), ...cache.records], hasMore: res.hasMore, total: res.total };
		} finally {
			setLoadingOlder(false);
		}
	}

	function changeMode(next: TrajectoryMode) {
		if (next === mode()) return;
		setMode(next);
		if (open() && origin) rebuildFromOrigin();
		else if (open()) void view();
	}

	let lastSeenName: string | null = null;
	createEffect(() => {
		const name = getSelectedName();
		if (name === lastSeenName) return;
		lastSeenName = name;
		cache = null;
		originStale = false;
		setOpen(false);
	});

	function flash(id: number) {
		setFlashId(id);
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => setFlashId(null), 1200);
	}

	function invalidate() {
		cache = null;
		originStale = true;
		if (open()) void view();
	}

	return { open, records, total, mode, changeMode, loading, hasMore, loadingOlder, flashId, view, loadOlder, flash, invalidate, setOpen };
}
