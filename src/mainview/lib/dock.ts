import { createStore } from "zustand/vanilla";
import { clampPaneWidth } from "./grip";

export type DockPanel = "explorer" | "git" | "replies";

export interface RevealRange {
	start: number;
	end: number;
}

export interface RevealTarget {
	path: string;
	seq: number;
	range?: RevealRange;
}

const DOCK_WIDTH_KEY = "dock.width";
const LIST_OPEN_KEY = "dock.listOpen";
const PANE_WIDTH_KEY = "dock.paneWidth";
const LIST_WIDTH_KEY = "chatlist.width";
const WRAP_KEY = "reader.wrap";
const SIDE_BY_SIDE_KEY = "reader.sideBySide";
const IGNORE_WS_KEY = "reader.ignoreWhitespace";

/** The dock column: its own width, unaffected by the sidebar opening or closing. */
export const DOCK_MIN = 360;
export const DOCK_DEFAULT = 560;
/** The dock's inner split: the panel's own list beside its detail. */
export const PANE_MIN = 200;
export const PANE_MAX = 420;
export const PANE_DEFAULT = 280;
export const LIST_MIN = 200;
export const LIST_MAX = 480;
export const LIST_DEFAULT = 240;

/** The detail beside the pane: below this the pane stands aside and the detail takes the column. */
export const DOCK_DETAIL_MIN = 320;

/** The workbench is the remainder; both drags must leave it this much. */
export const WORKBENCH_MIN = 420;

export interface DockState {
	panels: Record<string, DockPanel | null>;
	reveal: RevealTarget | null;
	dockWidth: number;
	paneWidth: number;
	listOpen: boolean;
	listWidth: number;
	wrap: boolean;
	sideBySide: boolean;
	ignoreWhitespace: boolean;
}

function storedDockWidth(): number {
	const stored = Number(localStorage.getItem(DOCK_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? Math.max(DOCK_MIN, stored) : DOCK_DEFAULT;
}

function storedPaneWidth(): number {
	const stored = Number(localStorage.getItem(PANE_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? clampPaneWidth(stored, PANE_MIN, PANE_MAX) : PANE_DEFAULT;
}

function storedListWidth(): number {
	const stored = Number(localStorage.getItem(LIST_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? clampPaneWidth(stored, LIST_MIN, LIST_MAX) : LIST_DEFAULT;
}

export function createDock(options: { onOpen?: () => void; partner?: () => string | null } = {}) {
	const store = createStore<DockState>()(() => ({
		panels: {},
		reveal: null,
		dockWidth: storedDockWidth(),
		paneWidth: storedPaneWidth(),
		listOpen: localStorage.getItem(LIST_OPEN_KEY) !== "0",
		listWidth: storedListWidth(),
		wrap: localStorage.getItem(WRAP_KEY) !== "0",
		sideBySide: localStorage.getItem(SIDE_BY_SIDE_KEY) !== "0",
		ignoreWhitespace: localStorage.getItem(IGNORE_WS_KEY) === "1",
	}));
	let seq = 0;

	const current = () => options.partner?.() ?? null;
	const panel = () => {
		const partner = current();
		return partner ? (store.getState().panels[partner] ?? null) : null;
	};

	function setPanel(next: DockPanel | null) {
		const partner = current();
		if (!partner) return;
		store.setState((state) => (state.panels[partner] === next ? state : { panels: { ...state.panels, [partner]: next } }));
	}

	function toggle(next: DockPanel) {
		options.onOpen?.();
		setPanel(panel() === next ? null : next);
	}

	function open(next: DockPanel) {
		options.onOpen?.();
		setPanel(next);
	}

	function close() {
		setPanel(null);
	}

	function setDockWidth(width: number) {
		store.setState({ dockWidth: width });
	}

	function commitDockWidth() {
		localStorage.setItem(DOCK_WIDTH_KEY, String(Math.round(store.getState().dockWidth)));
	}

	function toggleListOpen() {
		store.setState((state) => {
			localStorage.setItem(LIST_OPEN_KEY, state.listOpen ? "0" : "1");
			return { listOpen: !state.listOpen };
		});
	}

	function setListWidth(width: number) {
		store.setState({ listWidth: width });
	}

	function commitListWidth() {
		localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(store.getState().listWidth)));
	}

	function toggleWrap() {
		store.setState((state) => {
			localStorage.setItem(WRAP_KEY, state.wrap ? "0" : "1");
			return { wrap: !state.wrap };
		});
	}

	function toggleSideBySide() {
		store.setState((state) => {
			localStorage.setItem(SIDE_BY_SIDE_KEY, state.sideBySide ? "0" : "1");
			return { sideBySide: !state.sideBySide };
		});
	}

	function toggleIgnoreWhitespace() {
		store.setState((state) => {
			localStorage.setItem(IGNORE_WS_KEY, state.ignoreWhitespace ? "0" : "1");
			return { ignoreWhitespace: !state.ignoreWhitespace };
		});
	}

	/** `collapseTree` is for "jump to this file" gestures (a link, a line reference): the reader takes
	 *  the column and the tree waits behind its toggle. It is remembered — opening the tree by hand
	 *  brings it back for good. */
	function revealInExplorer(path: string, range?: RevealRange | null, opts?: { collapseTree?: boolean }) {
		const partner = current();
		if (!partner) return;
		options.onOpen?.();
		seq += 1;
		const reveal: RevealTarget = { path, seq, ...(range ? { range } : {}) };
		if (opts?.collapseTree) localStorage.setItem(LIST_OPEN_KEY, "0");
		store.setState((state) => ({ reveal, panels: { ...state.panels, [partner]: "explorer" }, ...(opts?.collapseTree ? { listOpen: false } : {}) }));
	}

	return {
		store,
		panel,
		toggle,
		open,
		close,
		setDockWidth,
		commitDockWidth,
		toggleListOpen,
		setListWidth,
		commitListWidth,
		toggleWrap,
		toggleSideBySide,
		toggleIgnoreWhitespace,
		revealInExplorer,
	};
}

export type Dock = ReturnType<typeof createDock>;
