import { createEffect, createMemo, createSignal } from "solid-js";
import { projectVisibleHistory } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { fold } from "../../shared/timeline";
import { useSession } from "./contexts/session-context";

export type TrajectoryMode = "origin" | "slice" | "view";

export function createTrajectory() {
	const { data: session, mutate: sessionMutate } = useSession();
	const [open, setOpen] = createSignal(false);
	const [mode, setMode] = createSignal<TrajectoryMode>("origin");

	const records = createMemo<TrajectoryRecord[]>(() => {
		const entries = session.origin.entries;
		const all = fold(entries);
		if (mode() === "view") {
			const viewIds = new Set(projectVisibleHistory(entries).map((v) => v.id));
			return all.filter((r) => viewIds.has(r.entryId));
		}
		return all;
	});

	function view() {
		const name = session.selected;
		if (!name) return;
		setMode("origin");
		setOpen(true);
		void sessionMutate.originRefresh();
	}

	function changeMode(next: TrajectoryMode) {
		setMode(mode() === next ? "origin" : next);
	}

	createEffect(() => {
		void session.selected;
		setOpen(false);
	});

	return {
		data: { open, records, mode },
		mutate: { setOpen, changeMode, view },
	};
}
