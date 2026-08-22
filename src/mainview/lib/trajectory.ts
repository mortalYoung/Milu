import { createSignal } from "solid-js";
import type { TrajectoryRecord } from "../../shared/rpc";
import type { RPC } from "./rpc";

/** Trajectory drawer (density strip): whole-log view, opened from the header. */
export function createTrajectory(rpc: RPC, getSelectedName: () => string | null) {
	const [open, setOpen] = createSignal(false);
	const [records, setRecords] = createSignal<TrajectoryRecord[]>([]);
	// Locate flash: the target bubble briefly flashes seal-soft (replies outline locate)
	const [flashId, setFlashId] = createSignal<number | null>(null);

	// Cache keyed by the partner whose log it is: switching chats invalidates implicitly,
	// persisting a turn invalidates explicitly (invalidate()).
	let cache: { name: string | null; records: TrajectoryRecord[] } | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	async function view() {
		const name = getSelectedName();
		if (cache === null || cache.name !== name) {
			const res = await rpc.request.trajectory({});
			cache = { name, records: res.records };
		}
		setRecords(cache.records);
		setOpen(true);
	}

	function flash(id: number) {
		setFlashId(id);
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => setFlashId(null), 1200);
	}

	/** A turn has been persisted (agent_message / trajectory_update); the next open fetches the latest. */
	function invalidate() {
		cache = null;
	}

	return { open, records, flashId, view, flash, invalidate, setOpen };
}
