import { batch, createSignal } from "solid-js";

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

function storedLetterWidth(): number | null {
	const stored = Number(localStorage.getItem(LETTER_WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? stored : null;
}

/** At most one docked panel is open at a time; the Explorer also accepts reveal requests (open + locate a file). */
export function createDock(options: { onOpen?: () => void } = {}) {
	const [panel, setPanel] = createSignal<DockPanel | null>(null);
	const [reveal, setReveal] = createSignal<RevealTarget | null>(null);
	const [pinned, setPinned] = createSignal(localStorage.getItem("explorer.pinned") === "1");
	// Pixels once dragged; null keeps the responsive default the pinned layout ships with.
	const [letterWidth, setLetterWidth] = createSignal(storedLetterWidth());
	let seq = 0;

	function toggle(next: DockPanel) {
		batch(() => {
			options.onOpen?.();
			setPanel((current) => (current === next ? null : next));
		});
	}

	function close() {
		setPanel(null);
	}

	/** Pinned means the reader shares the row with the letter instead of covering it. Remembered. */
	function togglePinned() {
		setPinned((value) => {
			localStorage.setItem("explorer.pinned", value ? "0" : "1");
			return !value;
		});
	}

	function commitLetterWidth() {
		const width = letterWidth();
		if (width != null) localStorage.setItem(LETTER_WIDTH_KEY, String(Math.round(width)));
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

	return { panel, reveal, pinned, togglePinned, letterWidth, setLetterWidth, commitLetterWidth, toggle, close, revealInExplorer };
}

export type Dock = ReturnType<typeof createDock>;
