import { createStore } from "zustand/vanilla";
import { EVENT_META, projectView, type SliceItem } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { foldSliceItems } from "../../shared/slice";
import { buildData } from "../../shared/timeline";
import type { Session } from "./session";

export type TrajectoryMode = "origin" | "slice" | "view";

interface TrajectoryState {
	open: boolean;
	mode: TrajectoryMode;
	records: TrajectoryRecord[];
	sliceItems: SliceItem[];
}

export function createTrajectory(session: Session) {
	const store = createStore<TrajectoryState>()(() => ({ open: false, mode: "origin", records: [], sliceItems: [] }));

	function recompute() {
		const entries = session.store.getState().origin.entries;
		const all = buildData(entries);
		const sliceItems = foldSliceItems(entries);
		const mode = store.getState().mode;
		if (mode === "slice") {
			const byEntry = new Map(all.map((record) => [record.entryId, record]));
			const records: TrajectoryRecord[] = [];
			for (const item of sliceItems) {
				const record = byEntry.get(item.id);
				if (record === undefined) continue;
				records.push({ ...(EVENT_META[record.metaKey]?.slice?.as?.(record) ?? record), sliceMessage: item.message });
			}
			store.setState({ records, sliceItems });
			return;
		}
		if (mode === "view") {
			const viewIds = new Set(projectView(entries).map((entry) => entry.id));
			store.setState({ records: all.filter((record) => viewIds.has(record.entryId)), sliceItems });
			return;
		}
		store.setState({ records: all, sliceItems });
	}

	session.store.subscribe((state, previous) => {
		if (state.selected === previous.selected && state.origin.entries === previous.origin.entries) return;
		if (state.selected !== previous.selected) {
			store.setState({ open: false });
		}
		recompute();
	});

	function setOpen(open: boolean) {
		store.setState({ open });
	}

	function changeMode(next: TrajectoryMode) {
		store.setState((state) => ({ mode: state.mode === next ? "origin" : next }));
		recompute();
	}

	function toggle() {
		if (!session.store.getState().selected) return;
		if (store.getState().open) {
			setOpen(false);
			return;
		}
		store.setState({ open: true, mode: "origin" });
		recompute();
		void session.mutate.originRefresh();
	}

	return { store, recompute, mutate: { setOpen, changeMode, toggle } };
}

export type Trajectory = ReturnType<typeof createTrajectory>;
