export const FOLLOW_THRESHOLD = 24;

export const LEDGER_EPSILON = 0.5;

export const INPUT_WINDOW_MS = 400;

export const INPUT_CONCURRENT_MS = 100;

export const FOREIGN_RATIO = 4;

export const LOCATE_WINDOW_MS = 900;

export const hadRecentInput = (inputAgeMs: number, windowMs: number = INPUT_WINDOW_MS) => inputAgeMs <= windowMs;

export const inputWindowFor = (delta: number, clientHeight: number) => (Math.abs(delta) > clientHeight * FOREIGN_RATIO ? INPUT_CONCURRENT_MS : INPUT_WINDOW_MS);

export const looksForeign = (delta: number, clientHeight: number, inputAgeMs: number) =>
	Math.abs(delta) > clientHeight && !hadRecentInput(inputAgeMs, inputWindowFor(delta, clientHeight));

export const distanceToBottom = (scrollHeight: number, scrollTop: number, clientHeight: number) => scrollHeight - scrollTop - clientHeight;

export const isAtBottom = (dist: number) => dist <= FOLLOW_THRESHOLD + 1;

export const floorTop = (scrollHeight: number, clientHeight: number) => Math.max(0, scrollHeight - clientHeight);

export const classifyReader = (scrollTop: number, observedTop: number, floor: number) => Math.abs(scrollTop - Math.min(observedTop, floor)) > LEDGER_EPSILON;

export const flowTop = (rowTop: number, scrollportTop: number) => rowTop - scrollportTop;

export const compensatedTop = (scrollTopNow: number, rowTop: number, scrollportTop: number, anchorTop: number) => scrollTopNow + flowTop(rowTop, scrollportTop) - anchorTop;

export interface ScrollAnchor {
	key: string;

	anchorTop: number;
}

/** A row of a fixed-height list, held by key so it survives the rows being unmounted (virtualized)
 * or rows being prepended above it. */
export interface RowAnchor {
	key: string;

	within: number;
}

export const rowAnchorAt = (scrollTop: number, origin: number, rowHeight: number, keyAt: (index: number) => string | undefined): RowAnchor | null => {
	const index = Math.max(0, Math.floor((scrollTop - origin) / rowHeight));
	const key = keyAt(index);
	if (key === undefined) return null;
	return { key, within: scrollTop - origin - index * rowHeight };
};

export const rowAnchorTop = (anchor: RowAnchor, index: number, origin: number, rowHeight: number) => origin + index * rowHeight + anchor.within;

export const rowTopForIndex = (index: number, rowHeight: number, origin: number, clientHeight: number) => Math.max(0, index * rowHeight + origin - (clientHeight - rowHeight) / 2);
