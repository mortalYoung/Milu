export const FOLLOW_THRESHOLD = 24;

export const LEDGER_EPSILON = 0.5;

export const distanceToBottom = (scrollHeight: number, scrollTop: number, clientHeight: number) => scrollHeight - scrollTop - clientHeight;

export const isAtBottom = (dist: number) => dist <= FOLLOW_THRESHOLD + 1;

export const floorTop = (scrollHeight: number, clientHeight: number) => Math.max(0, scrollHeight - clientHeight);

export const classifyReader = (scrollTop: number, observedTop: number, floor: number) => Math.abs(scrollTop - Math.min(observedTop, floor)) > LEDGER_EPSILON;

export const flowTop = (rowTop: number, scrollportTop: number) => rowTop - scrollportTop;

export const compensatedTop = (anchor: { scrollTop: number; anchorTop: number }, rowTop: number, scrollportTop: number) =>
	anchor.scrollTop + flowTop(rowTop, scrollportTop) - anchor.anchorTop;

export interface ScrollAnchor {
	key: string;

	anchorTop: number;

	scrollTop: number;
}
