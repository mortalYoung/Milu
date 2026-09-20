/**
 * IME guards for the WKWebView webview.
 *
 * Two things bite us there: (1) `keydown` fires for the Enter that commits a candidate, and
 * (2) pinyin-mode English is committed with syllable spaces ("hap p" instead of "happ"), so the
 * committed text has to be re-written once the composition ends.
 */
export type EditableElement = HTMLInputElement | HTMLTextAreaElement;

export function fixWebkitImeCommit(e: CompositionEvent, el: EditableElement | undefined, set: (value: string) => void): void {
	const data = e.data ?? "";
	if (!/^[A-Za-z\s]+$/.test(data) || data === data.replace(/\s/g, "")) return;
	const pending = el ? { data, fixed: data.replace(/\s/g, ""), cursor: el.selectionStart ?? el.value.length } : null;
	setTimeout(() => {
		if (!pending || !el) return;
		const value = el.value;
		const start = Math.max(0, pending.cursor - pending.data.length);
		if (value.slice(start, start + pending.data.length) !== pending.data) return;
		const next = value.slice(0, start) + pending.fixed + value.slice(start + pending.data.length);
		set(next);
		el.value = next;
		const pos = start + pending.fixed.length;
		el.setSelectionRange(pos, pos);
	}, 0);
}

export function imeGuard(set: (value: string) => void) {
	let composing = false;
	const release = () =>
		setTimeout(() => {
			composing = false;
		}, 10);
	return {
		get composing() {
			return composing;
		},
		onStart() {
			composing = true;
		},
		onEnd(e: CompositionEvent, el: EditableElement | undefined) {
			fixWebkitImeCommit(e, el, set);
			release();
		},
		onKeyDown(e: KeyboardEvent) {
			if (e.key === "Enter" && (composing || e.isComposing || e.keyCode === 229)) e.preventDefault();
		},
	};
}
