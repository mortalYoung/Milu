import { createStore } from "zustand/vanilla";

const BOTTOM_SLACK = 24;
const INTENT_WINDOW_MS = 400;

interface Anchor {
	readonly id: string;
	top: number;
}

function hasSelection(element: HTMLElement): boolean {
	const selection = window.getSelection();
	if (selection == null || selection.isCollapsed) return false;
	return element.contains(selection.anchorNode);
}

function atBottom(element: HTMLElement): boolean {
	return element.scrollHeight - element.clientHeight - element.scrollTop < BOTTOM_SLACK;
}

function anchorOf(scroller: HTMLElement, content: HTMLElement): Anchor | null {
	const frame = scroller.getBoundingClientRect().top;
	for (const row of content.querySelectorAll<HTMLElement>("[data-entry]")) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom > frame) return { id: row.dataset["entry"] ?? "", top: rect.top };
	}
	return null;
}

/** The transcript's one owner of `scrollTop`: pins to the bottom while the reader follows, holds their place while they don't. */
export class TranscriptScroll {
	readonly store = createStore<{ following: boolean }>()(() => ({ following: true }));

	private _scroller: HTMLElement | null = null;
	private _content: HTMLElement | null = null;
	private _paused: { readonly current: boolean } | null = null;
	private _observed = 0;
	private _intent = 0;
	private _frame: number | null = null;
	private _anchor: Anchor | null = null;
	private _release: (() => void) | null = null;

	get following(): boolean {
		return this.store.getState().following;
	}

	attach(scroller: HTMLElement, content: HTMLElement, paused: { readonly current: boolean }): void {
		this.detach();
		this._scroller = scroller;
		this._content = content;
		this._paused = paused;

		const markIntent = () => {
			this._intent = performance.now();
		};
		const onScroll = () => {
			if (this._paused?.current === true) return;
			if (Math.abs(scroller.scrollTop - this._observed) < 1) return;
			const bottom = atBottom(scroller);
			if (this.following && !bottom && performance.now() - this._intent > INTENT_WINDOW_MS) {
				this.pin();
				return;
			}
			this._follow(bottom);
		};
		const remember = () => {
			if (!this.following) this._anchor = anchorOf(scroller, content);
		};
		const settle = () => {
			if (this._paused?.current === true) return;
			if (this.following) {
				this._pinNow(false);
				return;
			}
			const held = this._anchor;
			if (held === null) return;
			const node = content.querySelector<HTMLElement>(`[data-entry="${CSS.escape(held.id)}"]`);
			if (!node) {
				this._anchor = anchorOf(scroller, content);
				return;
			}
			const delta = node.getBoundingClientRect().top - held.top;
			if (Math.abs(delta) < 0.5) return;
			this._anchor = { id: held.id, top: held.top + delta };
			this._write(scroller, scroller.scrollTop + delta);
		};
		const onKey = (event: KeyboardEvent) => {
			if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) markIntent();
		};

		scroller.addEventListener("scroll", onScroll, { passive: true });
		scroller.addEventListener("scroll", remember, { passive: true });
		scroller.addEventListener("wheel", markIntent, { passive: true });
		scroller.addEventListener("pointerdown", markIntent, { passive: true });
		scroller.addEventListener("touchmove", markIntent, { passive: true });
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("resize", remember);

		const rows = new ResizeObserver(settle);
		rows.observe(content);
		const mutations = new MutationObserver(settle);
		mutations.observe(content, { subtree: true, childList: true, characterData: true });
		void document.fonts?.ready.then(settle);

		this._release = () => {
			scroller.removeEventListener("scroll", onScroll);
			scroller.removeEventListener("scroll", remember);
			scroller.removeEventListener("wheel", markIntent);
			scroller.removeEventListener("pointerdown", markIntent);
			scroller.removeEventListener("touchmove", markIntent);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("resize", remember);
			rows.disconnect();
			mutations.disconnect();
		};
	}

	detach(): void {
		this._release?.();
		this._release = null;
		this._scroller = null;
		this._content = null;
		this._paused = null;
		this._anchor = null;
		if (this._frame !== null) cancelAnimationFrame(this._frame);
		this._frame = null;
	}

	pin(force = false): void {
		if (this._frame !== null) cancelAnimationFrame(this._frame);
		this._frame = requestAnimationFrame(() => {
			this._frame = null;
			this._pinNow(force);
		});
	}

	hold(): void {
		const scroller = this._scroller;
		const content = this._content;
		if (scroller && content) this._anchor = anchorOf(scroller, content);
		this._follow(false);
	}

	private _pinNow(force: boolean): void {
		const scroller = this._scroller;
		if (!scroller || this._paused?.current === true) return;
		if (!force && (!this.following || hasSelection(scroller))) return;
		this._write(scroller, scroller.scrollHeight);
		this._anchor = null;
		this._follow(true);
	}

	private _write(scroller: HTMLElement, top: number): void {
		scroller.scrollTop = top;
		this._observed = scroller.scrollTop;
	}

	private _follow(next: boolean): void {
		if (this.following === next) return;
		this.store.setState({ following: next });
	}
}
