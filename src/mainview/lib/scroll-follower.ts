import { createStore, type StoreApi } from "zustand/vanilla";
import { classifyReader, compensatedTop, distanceToBottom, floorTop, flowTop, isAtBottom, LOCATE_WINDOW_MS, looksForeign, type ScrollAnchor } from "./scroll-anchor";

export interface ScrollState {
	containerEl: HTMLElement | null;
	contentEl: HTMLElement | null;
	following: boolean;
	locateFlashId: number | null;
}

export interface ScrollFollower {
	store: StoreApi<ScrollState>;
	setContainer: (el: HTMLElement | null) => void;
	setContent: (el: HTMLElement | null) => void;
	offsetInContent: (el: HTMLElement) => number;
	hold: () => void;
	pin: (force?: boolean) => void;
	pinNow: (force?: boolean) => void;
	seek: (top: number) => void;
	locate: (id: number) => void;
}

/** How a follower remembers the reader's place across a re-layout: capture it from the live DOM,
 * then compute where the scroller has to land for that place to look the same. */
export interface ScrollAnchorStrategy<A> {
	capture: (el: HTMLElement) => A | null;
	compensate: (el: HTMLElement, anchor: A) => number | null;
}

export interface ScrollFollowerOptions<A> {
	source: (onChange: (emptied: boolean) => void) => void;
	anchor: ScrollAnchorStrategy<A>;
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

const INPUT_EVENTS = ["wheel", "touchstart", "touchmove", "focusin"] as const;

function innermostRow(matches: HTMLElement[]): HTMLElement | null {
	for (const row of matches) if (!row.querySelector("[data-chat-anchor-key]")) return row;
	return matches[0] ?? null;
}

function anchorRow(el: HTMLElement): HTMLElement | null {
	const rect = el.getBoundingClientRect();
	if (typeof document.elementsFromPoint === "function") {
		const x = rect.left + rect.width / 2;
		for (const node of document.elementsFromPoint(x, rect.top + 1)) {
			const row = (node as HTMLElement).closest?.("[data-chat-anchor-key]");
			if (row && el.contains(row)) return row as HTMLElement;
		}
	}
	for (const row of Array.from(el.querySelectorAll<HTMLElement>("[data-chat-anchor-key]"))) {
		if (row.querySelector("[data-chat-anchor-key]")) continue;
		if (row.getBoundingClientRect().bottom > rect.top) return row;
	}
	return null;
}

/** Rows carry `data-chat-anchor-key`; the anchor is the one at the scrollport's top edge. */
export const domRowAnchor: ScrollAnchorStrategy<ScrollAnchor> = {
	capture(el) {
		const row = anchorRow(el);
		const key = row?.dataset["chatAnchorKey"];
		if (!row || !key) return null;
		return { key, anchorTop: flowTop(row.getBoundingClientRect().top, el.getBoundingClientRect().top) };
	},
	compensate(el, anchor) {
		const row = innermostRow(Array.from(el.querySelectorAll<HTMLElement>(`[data-chat-anchor-key="${CSS.escape(anchor.key)}"]`)));
		if (!row) return null;
		return compensatedTop(el.scrollTop, row.getBoundingClientRect().top, el.getBoundingClientRect().top, anchor.anchorTop);
	},
};

export function createScrollFollower<A>(options: ScrollFollowerOptions<A>): ScrollFollower {
	const store = createStore<ScrollState>()(() => ({
		containerEl: null,
		contentEl: null,
		following: true,
		locateFlashId: null,
	}));

	let containerEl: HTMLElement | null = null;
	let contentElValue: HTMLElement | null = null;
	let detach: (() => void) | null = null;
	let observedTop = 0;
	let anchor: A | null = null;
	let pinRaf: number | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let lastInputAt = 0;
	let explainedUntil = 0;
	let foreignRun = 0;
	let foreignCheck: number | null = null;

	const following = () => store.getState().following;
	const inputAge = () => performance.now() - lastInputAt;

	function hasTextSelection(): boolean {
		const selection = window.getSelection();
		return selection != null && !selection.isCollapsed;
	}

	function writeScrollTop(el: HTMLElement, top: number) {
		const before = el.scrollTop;
		el.scrollTop = top;
		observedTop = el.scrollTop;
		if (el.scrollTop !== before && foreignCheck != null) {
			cancelAnimationFrame(foreignCheck);
			foreignCheck = null;
		}
		foreignRun = 0;
	}

	function followBottom() {
		anchor = null;
		store.setState({ following: true });
	}

	function pinNow(force = false) {
		const el = containerEl;
		if (!el) return;
		if (!force && (!following() || hasTextSelection())) return;
		writeScrollTop(el, el.scrollHeight);
		followBottom();
	}

	function pin(force = false) {
		if (pinRaf != null) cancelAnimationFrame(pinRaf);
		pinRaf = requestAnimationFrame(() => {
			pinRaf = null;
			pinNow(force);
		});
	}

	function captureAnchor(el: HTMLElement) {
		observedTop = el.scrollTop;
		anchor = options.anchor.capture(el);
	}

	function release(el: HTMLElement) {
		if (isAtBottom(distanceToBottom(el.scrollHeight, el.scrollTop, el.clientHeight))) {
			followBottom();
			return;
		}
		store.setState({ following: false });
		captureAnchor(el);
	}

	function holdPlace() {
		const el = containerEl;
		if (!el || anchor === null) return;
		const target = options.anchor.compensate(el, anchor);
		if (target === null) return;
		writeScrollTop(el, target);
		anchor = options.anchor.capture(el);
	}

	function hold() {
		const el = containerEl;
		if (!el) return;
		captureAnchor(el);
		store.setState({ following: false });
	}

	function seek(top: number) {
		const el = containerEl;
		if (!el) return;
		writeScrollTop(el, top);
		release(el);
	}

	function healForeign(el: HTMLElement) {
		if (hasTextSelection()) return;
		writeScrollTop(el, following() ? el.scrollHeight : Math.min(observedTop, floorTop(el.scrollHeight, el.clientHeight)));
	}

	function rejudge(el: HTMLElement) {
		if (following()) {
			pin();
			return;
		}
		if (isAtBottom(distanceToBottom(el.scrollHeight, el.scrollTop, el.clientHeight))) followBottom();
	}

	function attach() {
		detach?.();
		detach = null;
		const el = containerEl;
		const body = contentElValue;
		if (!el || !body) return;

		const onScroll = () => {
			const floor = floorTop(el.scrollHeight, el.clientHeight);
			if (!classifyReader(el.scrollTop, observedTop, floor)) return;
			if (foreignCheck != null) {
				cancelAnimationFrame(foreignCheck);
				foreignCheck = null;
			}
			const delta = el.scrollTop - observedTop;
			if (performance.now() >= explainedUntil && looksForeign(delta, el.clientHeight, inputAge())) {
				foreignRun += 1;
				if (foreignRun === 1) {
					const jumpedTo = el.scrollTop;
					foreignCheck = requestAnimationFrame(() => {
						foreignCheck = requestAnimationFrame(() => {
							foreignCheck = null;
							if (foreignRun !== 1 || Math.abs(el.scrollTop - jumpedTo) > 0.5) return;
							healForeign(el);
							foreignRun = 0;
						});
					});
					return;
				}
			}
			foreignRun = 0;
			release(el);
		};
		el.addEventListener("scroll", onScroll, { passive: true });

		const onInput = () => {
			lastInputAt = performance.now();
			foreignRun = 0;
		};
		for (const type of INPUT_EVENTS) el.addEventListener(type, onInput, { passive: true, capture: true });
		const onKey = (event: KeyboardEvent) => {
			if (SCROLL_KEYS.has(event.key)) lastInputAt = performance.now();
		};
		document.addEventListener("keydown", onKey, true);

		const rows = new ResizeObserver(() => (following() ? pin() : holdPlace()));
		rows.observe(body);

		const host = new ResizeObserver(() => rejudge(el));
		host.observe(el);

		detach = () => {
			el.removeEventListener("scroll", onScroll);
			for (const type of INPUT_EVENTS) el.removeEventListener(type, onInput, { capture: true });
			document.removeEventListener("keydown", onKey, true);
			rows.disconnect();
			host.disconnect();
		};
	}

	function setContainer(el: HTMLElement | null) {
		containerEl = el;
		store.setState({ containerEl: el });
		attach();
	}

	function setContent(el: HTMLElement | null) {
		contentElValue = el;
		store.setState({ contentEl: el });
		attach();
	}

	options.source((emptied) => {
		if (emptied) {
			followBottom();
			return;
		}
		if (following()) pin();
	});

	return {
		store,
		setContainer,
		setContent,
		offsetInContent: (el: HTMLElement) => el.getBoundingClientRect().top - (contentElValue?.getBoundingClientRect().top ?? 0),
		hold,
		pin,
		pinNow,
		seek,
		locate: (id: number) => {
			const el = document.getElementById("entry-" + id);
			if (!el) return;
			explainedUntil = performance.now() + LOCATE_WINDOW_MS;
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			store.setState({ locateFlashId: id });
			clearTimeout(flashTimer);
			flashTimer = setTimeout(() => store.setState({ locateFlashId: null }), 1200);
		},
	};
}
