import { batch, createSignal } from "solid-js";
import { clampPaneWidth } from "../components/DockGrip";

export type DockPanel = "explorer" | "git" | "replies";

export interface RevealRange {
	/** 1-based, inclusive — the `path#16` / `path#74-80` syntax the Explorer copies. */
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
const WRAP_KEY = "reader.wrap";

/**
 * One width for every docked surface. The explorer's tree and the git change list are the same
 * column as far as the reader is concerned, so a size set on one holds on the other — and one range
 * has to serve both: narrow enough that a file name still reads, wide enough that a path does.
 */
export const DOCK_PANE_MIN = 200;
export const DOCK_PANE_MAX = 420;
export const DOCK_PANE_DEFAULT = 280;

function storedLetterWidth(): number | null {
	const stored = Number(localStorage.getItem(LETTER_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? stored : null;
}

function storedPaneWidth(): number {
	const stored = Number(localStorage.getItem(PANE_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? clampPaneWidth(stored, DOCK_PANE_MIN, DOCK_PANE_MAX) : DOCK_PANE_DEFAULT;
}

/** At most one docked panel is open at a time; the Explorer also accepts reveal requests (open + locate a file). */
export function createDock(options: { onOpen?: () => void; partner?: () => string | null } = {}) {
	const current = () => options.partner?.() ?? null;
	const [panels, setPanels] = createSignal<Record<string, DockPanel | null>>({});
	const [reveal, setReveal] = createSignal<RevealTarget | null>(null);
	const [pins, setPins] = createSignal<Record<string, Partial<Record<DockPanel, boolean>>>>({});
	// Shared by every docked panel: dragging the divider in one dock sizes the other the same way.
	const [paneWidth, setPaneWidth] = createSignal(storedPaneWidth());
	// Pixels once dragged; null keeps the responsive default the pinned layout ships with.
	const [letterWidth, setLetterWidth] = createSignal(storedLetterWidth());
	// A reader preference, so it outlives the file it was set on.
	const [wrap, setWrap] = createSignal(localStorage.getItem(WRAP_KEY) === "1");
	let seq = 0;

	/**
	 * Which panel is open is a partner's own state, like the file it was reading: a partner that has no
	 * workspace closes its explorer without closing anyone else's, and coming back shows what that
	 * partner had. No partner, no dock.
	 */
	const panel = () => {
		const partner = current();
		return partner ? (panels()[partner] ?? null) : null;
	};

	function setPanel(next: DockPanel | null) {
		const partner = current();
		if (!partner) return;
		setPanels((prev) => (prev[partner] === next ? prev : { ...prev, [partner]: next }));
	}

	function toggle(next: DockPanel) {
		batch(() => {
			options.onOpen?.();
			setPanel(panel() === next ? null : next);
		});
	}

	function close() {
		setPanel(null);
	}

	/**
	 * Pinned means the reader shares the row with the letter instead of covering it — a property of the
	 * file in front of it, so the key is the file's own panel and its partner. Leaving the file puts the
	 * pin down with it (the shell sees to that); leaving the partner, or the dock, does not, because each
	 * partner keeps its own reader, and the pin goes wherever that reader is. Session-only: the file
	 * belongs to the panel, and a pin that outlived its file would leave a dock with nothing to release.
	 */
	function pinned(partner: string | null, panel: DockPanel | null) {
		return partner != null && panel != null && pins()[partner]?.[panel] === true;
	}

	function togglePinned(partner: string | null, panel: DockPanel | null) {
		if (partner == null || panel == null) return;
		setPins((prev) => ({ ...prev, [partner]: { ...prev[partner], [panel]: !prev[partner]?.[panel] } }));
	}

	function commitLetterWidth() {
		const width = letterWidth();
		if (width != null) localStorage.setItem(LETTER_WIDTH_KEY, String(Math.round(width)));
	}

	function commitPaneWidth() {
		localStorage.setItem(PANE_WIDTH_KEY, String(Math.round(paneWidth())));
	}

	function toggleWrap() {
		setWrap((value) => {
			localStorage.setItem(WRAP_KEY, value ? "0" : "1");
			return !value;
		});
	}

	function revealInExplorer(path: string, range?: RevealRange | null) {
		// Reveal and panel are one state change: without the batch, effects flush between the two
		// writes and a consumer can see "request set, panel still closed".
		batch(() => {
			options.onOpen?.();
			seq += 1;
			setReveal({ path, seq, ...(range ? { range } : {}) });
			setPanel("explorer");
		});
	}
	return {
		panel,
		reveal,
		pinned,
		togglePinned,
		letterWidth,
		setLetterWidth,
		commitLetterWidth,
		paneWidth,
		setPaneWidth,
		commitPaneWidth,
		wrap,
		toggleWrap,
		toggle,
		close,
		revealInExplorer,
	};
}

export type Dock = ReturnType<typeof createDock>;
