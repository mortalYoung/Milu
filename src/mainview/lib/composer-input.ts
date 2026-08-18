/**
 * Pure Enter-key decision for the composer (IME-safe).
 *
 * Enter sends only when it is a plain English Enter: not part of an IME composition
 * (Chinese input methods use Enter to confirm the candidate — that keydown carries
 * keyCode 13 too and must NOT send), not a Shift+Enter newline, not an auto-repeat.
 * Kept free of DOM so it can be unit-tested without a browser.
 */
export interface EnterKeyState {
	keyCode: number;
	shiftKey: boolean;
	repeat: boolean;
	/** True while an IME composition is in progress (compositionstart … compositionend). */
	composing: boolean;
	/** e.isComposing — Chromium's standard composition marker on the event. */
	isComposing: boolean;
}

export function shouldSendOnEnter(state: EnterKeyState): boolean {
	// Shift+Enter is the newline UNCONDITIONALLY — decided before the IME guard so a
	// composition-closing Shift+Enter still breaks the line.
	if (state.keyCode === 13 && state.shiftKey) return false;
	// keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
	const composing = state.composing || state.isComposing || state.keyCode === 229;
	if (state.keyCode !== 13) return false;
	if (composing) return false;
	if (state.repeat) return false; // held-down Enter must not machine-gun sends
	return true;
}

/**
 * Middle-truncate a long workspace path for the composer chip: `~/…/letters`.
 * The chip's title attribute keeps the full path for hover.
 */
export function formatWorkspacePath(path: string, max = 48): string {
	if (path.length <= max) return path;
	const head = path.slice(0, Math.ceil(max * 0.45));
	const tail = path.slice(-Math.floor(max * 0.45));
	return `${head}…${tail}`;
}
