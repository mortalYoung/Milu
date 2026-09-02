import { createEffect, createSignal } from "solid-js";
import { projectVisibleHistory } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { foldSurface } from "../../shared/slice";
import { fold } from "../../shared/timeline";
import type { createOriginSession } from "./origin-session";
import type { RPC } from "./rpc";

const PAGE_SIZE = 200;
type OriginSession = ReturnType<typeof createOriginSession>;

/** Trajectory drawer viewer modes: show the whole Origin, or only Slice / View entries. */
export type TrajectoryMode = "origin" | "slice" | "view";

/** Trajectory drawer (density strip): paged whole-log view, opened from the header. */
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
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	/** Local projection path: Timeline = fold(loadedOrigin), filtered by mode with zero requests. */
	function rebuildFromOrigin() {
		if (!origin) return;
		const entries = origin.entries();
		const all = fold(entries);
		let next = all;
		if (mode() === "slice") {
			const sliceIds = new Set(foldSurface(entries).nodes.map((n) => n.id));
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
					if (origin.entries().length === 0) await origin.refresh();
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
			// Keep whatever rows are already visible; a failed toggle/fetch must not blank the list.
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

	/** Switch viewer mode; with origin this is a pure local refilter (no request). */
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
		setOpen(false);
	});

	function flash(id: number) {
		setFlashId(id);
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => setFlashId(null), 1200);
	}

	/** A turn has been persisted (agent_message / trajectory_update): refresh now if the drawer is open, otherwise on next open. */
	function invalidate() {
		cache = null;
		if (open()) void view();
	}

	return { open, records, total, mode, changeMode, loading, hasMore, loadingOlder, flashId, view, loadOlder, flash, invalidate, setOpen };
}
