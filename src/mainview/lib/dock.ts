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

const LETTER_WIDTH_KEY = "explorer.letterWidth";
const PANE_WIDTH_KEY = "dock.paneWidth";
const LIST_WIDTH_KEY = "chatlist.width";
const WRAP_KEY = "reader.wrap";
const SIDE_BY_SIDE_KEY = "reader.sideBySide";
const IGNORE_WS_KEY = "reader.ignoreWhitespace";

export const DOCK_PANE_MIN = 200;
export const DOCK_PANE_MAX = 420;
export const DOCK_PANE_DEFAULT = 280;
export const LIST_MIN = 200;
export const LIST_MAX = 480;
export const LIST_DEFAULT = 240;

export interface DockState {
	panels: Record<string, DockPanel | null>;
	reveal: RevealTarget | null;
	pins: Record<string, Partial<Record<DockPanel, boolean>>>;
	paneWidth: number;
	letterWidth: number | null;
	listWidth: number;
	wrap: boolean;
	sideBySide: boolean;
	ignoreWhitespace: boolean;
}

function storedLetterWidth(): number | null {
	const stored = Number(localStorage.getItem(LETTER_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? stored : null;
}

function storedPaneWidth(): number {
	const stored = Number(localStorage.getItem(PANE_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? clampPaneWidth(stored, DOCK_PANE_MIN, DOCK_PANE_MAX) : DOCK_PANE_DEFAULT;
}

function storedListWidth(): number {
	const stored = Number(localStorage.getItem(LIST_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? clampPaneWidth(stored, LIST_MIN, LIST_MAX) : LIST_DEFAULT;
}

export function createDock(options: { onOpen?: () => void; partner?: () => string | null } = {}) {
	const store = createStore<DockState>()(() => ({
		panels: {},
		reveal: null,
		pins: {},
		paneWidth: storedPaneWidth(),
		letterWidth: storedLetterWidth(),
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

	function pinned(partner: string | null, panel: DockPanel | null) {
		return partner != null && panel != null && store.getState().pins[partner]?.[panel] === true;
	}

	function togglePinned(partner: string | null, panel: DockPanel | null) {
		if (partner == null || panel == null) return;
		store.setState((state) => ({ pins: { ...state.pins, [partner]: { ...state.pins[partner], [panel]: !state.pins[partner]?.[panel] } } }));
	}

	function setLetterWidth(width: number | null) {
		store.setState({ letterWidth: width });
	}

	function commitLetterWidth() {
		const width = store.getState().letterWidth;
		if (width != null) localStorage.setItem(LETTER_WIDTH_KEY, String(Math.round(width)));
	}

	function setPaneWidth(width: number) {
		store.setState({ paneWidth: width });
	}

	function commitPaneWidth() {
		localStorage.setItem(PANE_WIDTH_KEY, String(Math.round(store.getState().paneWidth)));
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

	function revealInExplorer(path: string, range?: RevealRange | null) {
		const partner = current();
		if (!partner) return;
		options.onOpen?.();
		seq += 1;
		const reveal: RevealTarget = { path, seq, ...(range ? { range } : {}) };
		store.setState((state) => ({ reveal, panels: { ...state.panels, [partner]: "explorer" } }));
	}

	return {
		store,
		panel,
		toggle,
		open,
		close,
		pinned,
		togglePinned,
		setLetterWidth,
		commitLetterWidth,
		setPaneWidth,
		commitPaneWidth,
		setListWidth,
		commitListWidth,
		toggleWrap,
		toggleSideBySide,
		toggleIgnoreWhitespace,
		revealInExplorer,
	};
}

export type Dock = ReturnType<typeof createDock>;
