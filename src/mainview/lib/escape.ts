import { onCleanup } from "solid-js";

/**
 * One Esc consumer: what it is, where it sits, and how to leave it. `isOpen` is read when the key is
 * pressed, so a layer never keeps a second copy of its own state — the state stays where it lives.
 */
export interface EscapeLayer {
	id: string;
	order: number;
	isOpen: () => boolean;
	close: () => void;
}

/**
 * The stack, lowest first. Esc closes the highest open layer of this list, and the order is written
 * down here instead of being decided by who happened to register their listener first.
 *
 * Not in this list: Kobalte's own overlays (dialog, select, menu, popover). They keep their own
 * z-order, they sit above everything here, and they mark the key as handled when they dismiss — which
 * is what `escapeTop` yields to. So a modal owns Esc, and a modal's own nested popover owns it before
 * the modal does, without any of that having to be mirrored here.
 */
export const ESCAPE_ORDER = {
	palette: 90,
	composerMenu: 85,
	composerPanel: 84,
	meter: 83,
	trajectoryRow: 82,
	trajectory: 80,
	// The reader's own transient layers sit above the dock's detail: a line selection clears before
	// the file closes, and the find row clears before the selection does.
	readerFind: 78,
	readerSelection: 77,
	dockList: 76,
	dockDetail: 75,
	dock: 70,
} as const;

/** Layers that live inside a panel, by id. Read at key time; no reactivity, nothing to keep in sync. */
const published = new Map<string, EscapeLayer>();

/** Publish a layer whose state belongs to a panel. Call it in the component body that owns the state. */
export function useEscapeLayer(layer: EscapeLayer) {
	published.set(layer.id, layer);
	onCleanup(() => {
		if (published.get(layer.id) === layer) published.delete(layer.id);
	});
}

/** Everything open right now, highest first. */
function openEscapeLayers(app: EscapeLayer[]): EscapeLayer[] {
	return [...app, ...published.values()].filter((layer) => layer.isOpen()).sort((a, b) => b.order - a.order);
}

/** Closes the highest open layer. False when there was nothing to close. */
export function escapeTop(app: EscapeLayer[]): boolean {
	const [top] = openEscapeLayers(app);
	if (!top) return false;
	top.close();
	return true;
}
