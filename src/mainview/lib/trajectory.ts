import { createEffect, createSignal } from "solid-js";
import type { TrajectoryRecord } from "../../shared/rpc";
import type { RPC } from "./rpc";

/** Trajectory drawer (density strip): whole-log view, opened from the header. */
export function createTrajectory(rpc: RPC, getSelectedName: () => string | null) {
	const [open, setOpen] = createSignal(false);
	const [records, setRecords] = createSignal<TrajectoryRecord[]>([]);
	const [loading, setLoading] = createSignal(false);
	// Locate flash: the target bubble briefly flashes seal-soft (replies outline locate)
	const [flashId, setFlashId] = createSignal<number | null>(null);

	// Cache keyed by the partner whose log it is: switching chats invalidates implicitly,
	// persisting a turn invalidates explicitly (invalidate()).
	let cache: { name: string | null; records: TrajectoryRecord[] } | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	async function view() {
		const name = getSelectedName();
		if (!name) return;
		if (cache === null || cache.name !== name) {
			setLoading(true);
			try {
				const res = await rpc.request.trajectory({ name });
				// The selection may have changed while fetching — never show another chat's log
				if (getSelectedName() !== name) return;
				cache = { name, records: res.records };
				setRecords(cache.records);
			} finally {
				setLoading(false);
			}
		} else {
			setRecords(cache.records);
		}
		setOpen(true);
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

	return { open, records, loading, flashId, view, flash, invalidate, setOpen };
}
