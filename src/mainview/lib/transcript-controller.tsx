import { type Accessor, createContext, createEffect, createMemo, createSignal, type JSX, useContext } from "solid-js";
import type { Entry } from "../layouts/Transcript";
import { classifyReader, compensatedTop, distanceToBottom, floorTop, flowTop, isAtBottom, type ScrollAnchor } from "./scroll-anchor";

export const PAGE_SIZE = 5;

export interface TranscriptController {
	visibleBlocks: Accessor<(Entry | Entry[])[]>;
	hasMoreOlder: Accessor<boolean>;
	loadEarlierPending: Accessor<boolean>;
	showBackToBottom: Accessor<boolean>;
	scrollToBottom: (force?: boolean) => void;
	locate: (id: number) => void;
	loadEarlier: () => void;
	reset: () => void;
	attach: (container: HTMLElement, inner: HTMLElement) => void;
	detach: () => void;
}

export function createTranscriptController(props: {
	entries: Accessor<Entry[]>;
	onFlash?: (id: number) => void;

	sourceHasMore?: Accessor<boolean>;

	onLoadSourcePage?: () => Promise<boolean>;
}): TranscriptController {
	const [pageStart, setPageStart] = createSignal(0);
	const [loadEarlierPending, setLoadEarlierPending] = createSignal(false);
	const [showBackToBottom, setShowBackToBottom] = createSignal(false);

	let container: HTMLElement | null = null;
	let observedTop = 0;
	let atBottom = true;
	let anchor: ScrollAnchor | null = null;
	let pendingLoad = false;
	let lastLocateSeq = -1;
	let pageInitialized = false;
	let pinRaf: number | null = null;
	let cleanup: (() => void) | null = null;

	const stackCache = new Map<string, Entry[]>();
	const blocks = createMemo(() => {
		const out: (Entry | Entry[])[] = [];
		let stack: Entry[] | null = null;
		let stackKey = "";
		const flush = () => {
			if (stack) {
				let cached = stackCache.get(stackKey);
				if (!cached) {
					cached = stack;
					stackCache.set(stackKey, cached);
				}
				out.push(cached);
				stack = null;
				stackKey = "";
			}
		};
		for (const e of props.entries()) {
			if (e.kind === "agent" || e.kind === "escalation") {
				(stack ??= []).push(e);
				stackKey += e.key ?? String(e.id);
			} else {
				flush();
				out.push(e);
			}
		}
		flush();
		return out;
	});

	const findBlockIndex = (id: number) => {
		const all = blocks();
		return all.findIndex((b) => {
			const cards = Array.isArray(b) ? b : [b];
			return cards.some((c) => c.id === id);
		});
	};

	const visibleBlocks = createMemo(() => {
		const all = blocks();
		const start = Math.min(pageStart(), all.length);
		if (all.length === 0) return all;
		if (!pageInitialized) return all.slice(Math.max(0, all.length - PAGE_SIZE));
		return start > 0 ? all.slice(start) : all;
	});
	const hasMoreOlder = () => {
		if (blocks().length === 0) return false;
		if (pageStart() > 0) return true;
		if (!pageInitialized && blocks().length > PAGE_SIZE) return true;
		return props.sourceHasMore?.() ?? false;
	};

	const writeScrollTop = (el: HTMLElement, top: number) => {
		el.scrollTop = top;
		observedTop = el.scrollTop;
	};

	const pinToBottom = (force = false) => {
		if (pinRaf != null) cancelAnimationFrame(pinRaf);
		pinRaf = requestAnimationFrame(() => {
			pinRaf = null;
			const el = container;
			if (!el) return;
			if (!force && !atBottom) return;
			writeScrollTop(el, el.scrollHeight);
			atBottom = true;
			anchor = null;
			setShowBackToBottom(false);
		});
	};

	const pickAnchorRow = (el: HTMLElement): HTMLElement | null => {
		const rect = el.getBoundingClientRect();
		if (typeof document.elementsFromPoint === "function") {
			const x = rect.left + rect.width / 2;
			const y = rect.top + 1;
			for (const node of document.elementsFromPoint(x, y)) {
				const row = (node as HTMLElement).closest?.("[data-chat-anchor-key]");
				if (row && el.contains(row)) return row as HTMLElement;
			}
		}
		for (const row of Array.from(el.querySelectorAll<HTMLElement>("[data-chat-flow-key]"))) {
			if (row.getBoundingClientRect().bottom > rect.top) return row;
		}
		return null;
	};

	const compensateAnchor = () => {
		if (!anchor) return;
		const el = container;
		if (!el) return;
		const row = el.querySelector<HTMLElement>(`[data-chat-anchor-key="${CSS.escape(anchor.key)}"]`);
		if (!row) return;
		writeScrollTop(el, compensatedTop(anchor, row.getBoundingClientRect().top, el.getBoundingClientRect().top));
	};

	const loadEarlier = async (): Promise<void> => {
		if (pendingLoad) return;
		if (!pageInitialized && blocks().length > 0) {
			setPageStart(Math.max(0, blocks().length - PAGE_SIZE));
			pageInitialized = true;
		}
		if (pageStart() > 0) {
			pendingLoad = true;
			setLoadEarlierPending(true);
			try {
				await Promise.resolve();
				setPageStart((start) => Math.max(0, start - PAGE_SIZE));
				queueMicrotask(compensateAnchor);
			} finally {
				pendingLoad = false;
				setLoadEarlierPending(false);
			}
			return;
		}
		if (!props.sourceHasMore?.() || !props.onLoadSourcePage) return;
		pendingLoad = true;
		setLoadEarlierPending(true);
		try {
			const oldLen = blocks().length;
			const loaded = await props.onLoadSourcePage();
			if (!loaded) return;
			const added = blocks().length - oldLen;
			if (added > 0) {
				setPageStart(Math.max(0, added - PAGE_SIZE));
			}
		} finally {
			pendingLoad = false;
			setLoadEarlierPending(false);
			queueMicrotask(compensateAnchor);
		}
	};

	const loadUntil = async (blockIndex: number): Promise<void> => {
		while (pageStart() > blockIndex) {
			await loadEarlier();
		}
	};

	const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

	const attach = (el: HTMLElement, innerEl: HTMLElement) => {
		cleanup?.();
		container = el;
		const onScroll = () => {
			const floor = floorTop(el.scrollHeight, el.clientHeight);
			const movedByReader = classifyReader(el.scrollTop, observedTop, floor);
			if (!movedByReader) return;
			const dist = distanceToBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
			atBottom = isAtBottom(dist);
			if (atBottom) {
				anchor = null;
				setShowBackToBottom(false);
			} else {
				const row = pickAnchorRow(el);
				if (row?.dataset["chatAnchorKey"]) {
					anchor = {
						key: row.dataset["chatAnchorKey"],
						anchorTop: flowTop(row.getBoundingClientRect().top, el.getBoundingClientRect().top),
						scrollTop: el.scrollTop,
					};
				}
				setShowBackToBottom(true);
			}
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		const ro = new ResizeObserver(() => {
			if (atBottom) pinToBottom(false);
		});
		ro.observe(innerEl);
		cleanup = () => {
			el.removeEventListener("scroll", onScroll);
			ro.disconnect();
			container = null;
		};
	};

	const detach = () => {
		cleanup?.();
		cleanup = null;
	};

	createEffect(() => {
		const all = blocks();
		if (all.length === 0) return;
		if (!pageInitialized) {
			setPageStart(Math.max(0, all.length - PAGE_SIZE));
			pageInitialized = true;
		}
		if (atBottom) pinToBottom(false);
	});

	return {
		visibleBlocks,
		hasMoreOlder,
		loadEarlierPending,
		showBackToBottom,
		scrollToBottom: pinToBottom,
		reset: () => {
			stackCache.clear();
			pageInitialized = false;
			setPageStart(0);
			setLoadEarlierPending(false);
			setShowBackToBottom(false);
			anchor = null;
			atBottom = true;
			pendingLoad = false;
		},
		locate: (id: number) => {
			const seq = ++lastLocateSeq;
			void (async () => {
				let idx = findBlockIndex(id);
				while (idx < 0 && props.sourceHasMore?.() && props.onLoadSourcePage) {
					const before = blocks().length;
					const loaded = await props.onLoadSourcePage();
					if (!loaded) break;

					const added = blocks().length - before;
					if (pageStart() > 0 && added > 0) setPageStart((start) => start + added);
					idx = findBlockIndex(id);
				}
				if (idx < 0) return;
				if (idx < pageStart()) await loadUntil(idx);
				await nextFrame();
				if (seq !== lastLocateSeq) return;
				document.getElementById("entry-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" });
				props.onFlash?.(id);
			})();
		},
		loadEarlier: () => void loadEarlier(),
		attach,
		detach,
	};
}

const TranscriptContext = createContext<TranscriptController>();

export function TranscriptProvider(props: { controller: TranscriptController; children?: JSX.Element }) {
	return <TranscriptContext.Provider value={props.controller}>{props.children}</TranscriptContext.Provider>;
}

export function useTranscript(): TranscriptController {
	const ctx = useContext(TranscriptContext);
	if (!ctx) throw new Error("useTranscript must be used within TranscriptProvider");
	return ctx;
}
