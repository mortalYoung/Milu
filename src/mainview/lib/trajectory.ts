import { createEffect, createMemo, createSignal } from "solid-js";
import { projectVisibleHistory } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { surfaceNodeIds } from "../../shared/slice";
import { fold } from "../../shared/timeline";
import { useSession } from "./session-context";

export type TrajectoryMode = "origin" | "slice" | "view";

export function createTrajectory() {
	const { data: session, mutate: sessionMutate } = useSession();
	const [open, setOpen] = createSignal(false);
	const [mode, setMode] = createSignal<TrajectoryMode>("origin");
	const [flashId, setFlashId] = createSignal<number | null>(null);

	const records = createMemo<TrajectoryRecord[]>(() => {
		const entries = session.origin.entries;
		const all = fold(entries);
		if (mode() === "slice") {
			const sliceIds = surfaceNodeIds(entries);
			return all.filter((r) => sliceIds.has(r.entryId));
		}
		if (mode() === "view") {
			const viewIds = new Set(projectVisibleHistory(entries).map((v) => v.id));
			return all.filter((r) => viewIds.has(r.entryId));
		}
		return all;
	});

	function view() {
		const name = session.selected;
		if (!name) return;
		setOpen(true);
		void sessionMutate.originRefresh();
	}

	function changeMode(next: TrajectoryMode) {
		if (next === mode()) return;
		setMode(next);
	}

	let lastSeenName: string | null = null;
	createEffect(() => {
		const name = session.selected;
		if (name === lastSeenName) return;
		lastSeenName = name;
		setOpen(false);
	});

	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	function flash(id: number) {
		setFlashId(id);
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => setFlashId(null), 1200);
	}

	return {
		data: { open, records, mode, flashId },
		mutate: { setOpen, changeMode, view, flash },
	};
}
