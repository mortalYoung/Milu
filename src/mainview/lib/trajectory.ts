import { createEffect, createSignal } from "solid-js";
import type { TrajectoryRecord } from "../../shared/rpc";
import type { RPC } from "./rpc";

const PAGE_SIZE = 200;

/** Trajectory drawer (density strip): paged whole-log view, opened from the header. */
export function createTrajectory(rpc: RPC, getSelectedName: () => string | null) {
	const [open, setOpen] = createSignal(false);
	const [records, setRecords] = createSignal<TrajectoryRecord[]>([]);
	const [total, setTotal] = createSignal(0);
	const [surfaceOnly, setSurfaceOnly] = createSignal(false);
	const [loading, setLoading] = createSignal(false);
	const [hasMore, setHasMore] = createSignal(false);
	const [loadingOlder, setLoadingOlder] = createSignal(false);
	const [flashId, setFlashId] = createSignal<number | null>(null);

	let cache: { name: string | null; surfaceOnly: boolean; records: TrajectoryRecord[]; hasMore: boolean; total: number } | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	async function view() {
		const name = getSelectedName();
		if (!name) return;
		if (cache === null || cache.name !== name || cache.surfaceOnly !== surfaceOnly()) {
			setLoading(true);
			try {
				const res = await rpc.request.trajectory({ name, limit: PAGE_SIZE, surfaceOnly: surfaceOnly() });
				if (getSelectedName() !== name) return;
				cache = { name, surfaceOnly: surfaceOnly(), records: res.records, hasMore: res.hasMore, total: res.total };
				setRecords(cache.records);
				setHasMore(res.hasMore);
				setTotal(res.total);
			} catch {
				// Keep whatever rows are already visible; a failed toggle/fetch must not blank the list.
			} finally {
				setLoading(false);
			}
		} else {
			setRecords(cache.records);
			setHasMore(cache.hasMore);
			setTotal(cache.total);
		}
		setOpen(true);
	}

	async function loadOlder() {
		const name = getSelectedName();
		if (!name || loadingOlder() || !hasMore()) return;
		const before = records()[0]?.seq;
		if (before == null) return;
		setLoadingOlder(true);
		try {
			const res = await rpc.request.trajectory({ name, before, limit: PAGE_SIZE, surfaceOnly: surfaceOnly() });
			if (getSelectedName() !== name) return;
			setRecords((prev) => [...res.records.filter((r) => r.seq < before), ...prev]);
			setHasMore(res.hasMore);
			setTotal(res.total);
			if (cache) cache = { ...cache, records: [...res.records.filter((r) => r.seq < before), ...cache.records], hasMore: res.hasMore, total: res.total };
		} finally {
			setLoadingOlder(false);
		}
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

	function toggleSurface() {
		setSurfaceOnly((v) => !v);
		if (open()) void view();
	}

	return { open, records, total, surfaceOnly, toggleSurface, loading, hasMore, loadingOlder, flashId, view, loadOlder, flash, invalidate, setOpen };
}
