import { createStore, type StoreApi } from "zustand/vanilla";
import { classifyReader, compensatedTop, distanceToBottom, floorTop, flowTop, isAtBottom, type ScrollAnchor } from "./scroll-anchor";
import type { TranscriptController } from "./transcript";

export interface ScrollFollower {
	store: StoreApi<{ contentEl: HTMLElement | null; following: boolean; locateFlashId: number | null }>;
	setContainer: (el: HTMLElement | null) => void;
	setContent: (el: HTMLElement | null) => void;
	offsetInContent: (el: HTMLElement) => number;
	hold: () => void;
	pin: (force?: boolean) => void;
	locate: (id: number) => void;
}

function innermostRow(matches: HTMLElement[]): HTMLElement | null {
	for (const row of matches) if (!row.querySelector("[data-chat-anchor-key]")) return row;
	return matches[0] ?? null;
}

export function createScrollFollower(transcript: Pick<TranscriptController, "store">) {
	const store = createStore<{ contentEl: HTMLElement | null; following: boolean; locateFlashId: number | null }>()(() => ({
		contentEl: null,
		following: true,
		locateFlashId: null,
	}));

	let containerEl: HTMLElement | null = null;
	let contentElValue: HTMLElement | null = null;
	let detach: (() => void) | null = null;
	let observedTop = 0;
	let anchor: ScrollAnchor | null = null;
	let pinRaf: number | null = null;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	const following = () => store.getState().following;
	const setFollowing = (value: boolean) => store.setState({ following: value });

	function hasTextSelection(): boolean {
		const selection = window.getSelection();
		return selection != null && !selection.isCollapsed;
	}

	function writeScrollTop(el: HTMLElement, top: number) {
		el.scrollTop = top;
		observedTop = el.scrollTop;
	}

	function followBottom() {
		anchor = null;
		setFollowing(true);
	}

	function pin(force = false) {
		if (pinRaf != null) cancelAnimationFrame(pinRaf);
		pinRaf = requestAnimationFrame(() => {
			pinRaf = null;
			const el = containerEl;
			if (!el) return;
			if (!force && (!following() || hasTextSelection())) return;
			writeScrollTop(el, el.scrollHeight);
			followBottom();
		});
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

	function captureAnchor(el: HTMLElement) {
		const row = anchorRow(el);
		const key = row?.dataset["chatAnchorKey"];
		if (!row || !key) return;
		anchor = {
			key,
			anchorTop: flowTop(row.getBoundingClientRect().top, el.getBoundingClientRect().top),
			scrollTop: el.scrollTop,
		};
	}

	function release(el: HTMLElement) {
		if (isAtBottom(distanceToBottom(el.scrollHeight, el.scrollTop, el.clientHeight))) {
			followBottom();
			return;
		}
		setFollowing(false);
		captureAnchor(el);
	}

	function holdPlace() {
		if (!anchor) return;
		const el = containerEl;
		if (!el) return;
		const row = innermostRow(Array.from(el.querySelectorAll<HTMLElement>(`[data-chat-anchor-key="${CSS.escape(anchor.key)}"]`)));
		if (!row) return;
		writeScrollTop(el, compensatedTop(anchor, row.getBoundingClientRect().top, el.getBoundingClientRect().top));
		anchor = { key: anchor.key, anchorTop: anchor.anchorTop, scrollTop: observedTop };
	}

	function hold() {
		const el = containerEl;
		if (!el) return;
		captureAnchor(el);
		setFollowing(false);
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
			release(el);
		};
		el.addEventListener("scroll", onScroll, { passive: true });

		const rows = new ResizeObserver(() => (following() ? pin() : holdPlace()));
		rows.observe(body);

		const host = new ResizeObserver(() => rejudge(el));
		host.observe(el);

		detach = () => {
			el.removeEventListener("scroll", onScroll);
			rows.disconnect();
			host.disconnect();
		};
	}

	function setContainer(el: HTMLElement | null) {
		containerEl = el;
		attach();
	}

	function setContent(el: HTMLElement | null) {
		contentElValue = el;
		store.setState({ contentEl: el });
		attach();
	}

	transcript.store.subscribe((state, previous) => {
		if (state.blocks === previous.blocks) return;
		if (state.blocks.length === 0) {
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
		locate: (id: number) => {
			const el = document.getElementById("entry-" + id);
			if (!el) return;
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			store.setState({ locateFlashId: id });
			clearTimeout(flashTimer);
			flashTimer = setTimeout(() => store.setState({ locateFlashId: null }), 1200);
		},
	};
}
