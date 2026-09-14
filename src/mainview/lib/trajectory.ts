import { createEffect, createMemo, createSignal } from "solid-js";
import { EVENT_META, projectView, type SliceItem } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { foldSliceItems } from "../../shared/slice";
import { buildData } from "../../shared/timeline";
import { useSession } from "./contexts/session-context";

export type TrajectoryMode = "origin" | "slice" | "view";

export function createTrajectory() {
	const { data: session, mutate: sessionMutate } = useSession();
	const [open, setOpen] = createSignal(false);
	const [mode, setMode] = createSignal<TrajectoryMode>("origin");
	const all = createMemo<TrajectoryRecord[]>(() => buildData(session.origin.entries));
	const sliceItems = createMemo<SliceItem[]>(() => foldSliceItems(session.origin.entries));

	const sliceRecords = createMemo<TrajectoryRecord[]>(() => {
		const byEntry = new Map(all().map((record) => [record.entryId, record]));
		const out: TrajectoryRecord[] = [];
		for (const item of sliceItems()) {
			const record = byEntry.get(item.id);
			if (record === undefined) continue;
			out.push({ ...(EVENT_META[record.metaKey]?.slice?.as?.(record) ?? record), sliceMessage: item.message });
		}
		return out;
	});

	const records = createMemo<TrajectoryRecord[]>(() => {
		const entries = session.origin.entries;
		if (mode() === "slice") return sliceRecords();
		const data = all();
		if (mode() === "view") {
			const viewIds = new Set(projectView(entries).map((v) => v.id));
			return data.filter((r) => viewIds.has(r.entryId));
		}
		return data;
	});

	function toggle() {
		const name = session.selected;
		if (!name) return;
		if (open()) {
			setOpen(false);
			return;
		}
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
		data: { open, records, mode, sliceItems },
		mutate: { setOpen, changeMode, toggle },
	};
}
