export const GRIP_WIDTH = 7;

export function clampPaneWidth(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}
