import { createStore } from "zustand/vanilla";

const BOTTOM_SLACK = 24;

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
	let visible = frame;
	for (const head of content.querySelectorAll<HTMLElement>("[data-sticky-head]")) {
		const rect = head.getBoundingClientRect();
		if (rect.top <= frame + 1 && rect.bottom > visible) visible = rect.bottom;
	}
	for (const row of content.querySelectorAll<HTMLElement>("[data-entry]")) {
		const rect = row.getBoundingClientRect();
		if (rect.bottom > visible) return { id: row.dataset["entry"] ?? "", top: rect.top };
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

		const onScroll = () => {
			if (this._paused?.current === true) return;
			if (Math.abs(scroller.scrollTop - this._observed) < 1) return;
			this._follow(atBottom(scroller));
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
			if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) this._follow(atBottom(scroller));
		};

		scroller.addEventListener("scroll", onScroll, { passive: true });
		/** The scroller itself changed height — the composer grew, a column was dragged, the window moved. Pin now, in this frame. */
		const rejudge = () => {
			if (this._paused?.current === true) return;
			if (this.following) {
				this._pinNow(false);
				return;
			}
			this._anchor = anchorOf(scroller, content);
		};
		const frame = new ResizeObserver(rejudge);
		frame.observe(scroller);

		scroller.addEventListener("scroll", remember, { passive: true });
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("resize", rejudge);

		const rows = new ResizeObserver(settle);
		rows.observe(content);
		const mutations = new MutationObserver(settle);
		mutations.observe(content, { subtree: true, childList: true, characterData: true });
		void document.fonts?.ready.then(settle);

		this._release = () => {
			scroller.removeEventListener("scroll", onScroll);
			scroller.removeEventListener("scroll", remember);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("resize", rejudge);
			frame.disconnect();
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

	alignTo(element: HTMLElement): void {
		const scroller = this._scroller;
		if (!scroller) return;
		const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
		if (top >= scroller.scrollTop - 1) return;
		if (this._frame !== null) {
			cancelAnimationFrame(this._frame);
			this._frame = null;
		}
		this._follow(false);
		this._anchor = null;
		this._write(scroller, Math.max(0, top));
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
