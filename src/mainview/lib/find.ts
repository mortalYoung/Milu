import { getSearchQuery, SearchQuery, setSearchQuery } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createStore } from "zustand/vanilla";
import { activeSurface } from "./active-surface";
import { currentSpan, type HiddenSpans, matchSpans, noHidden } from "./cm6-find";
import { ESCAPE_ORDER, useEscapeLayer } from "./escape";
import type { SurfaceId } from "./surfaces";

export interface FindFlags {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}

export interface FindResult {
	count: number;
	active: number;
	valid: boolean;
}

export interface FindEngine {
	setQuery: (query: string, flags: FindFlags) => FindResult;
	step: (direction: 1 | -1) => FindResult;
	clear: () => void;
}

export interface FloatFindProps {
	query: string;
	result: FindResult;
	hint?: string;
	inputRef: RefObject<HTMLInputElement | null>;
	onQuery: (query: string) => void;
	onStep: (direction: 1 | -1) => void;
	onClose: () => void;
	onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

const findRouter = createStore<{ handlers: Map<SurfaceId, () => boolean> }>()(() => ({ handlers: new Map() }));

export function registerFindHandler(surface: SurfaceId, handler: () => boolean): () => void {
	findRouter.setState((state) => {
		const handlers = new Map(state.handlers);
		handlers.set(surface, handler);
		return { handlers };
	});
	return () => {
		findRouter.setState((state) => {
			if (state.handlers.get(surface) !== handler) return state;
			const handlers = new Map(state.handlers);
			handlers.delete(surface);
			return { handlers };
		});
	};
}

export function dispatchFind(): boolean {
	const surface = activeSurface();
	if (!surface) return false;
	const handler = findRouter.getState().handlers.get(surface);
	return handler ? handler() : false;
}

export function useFindHandler(surface: SurfaceId, handler: () => boolean): void {
	const latest = useRef(handler);
	latest.current = handler;

	useEffect(() => registerFindHandler(surface, () => latest.current()), [surface]);
}

export function useFindRouter(): { dispatch: () => boolean } {
	return useMemo(() => ({ dispatch: dispatchFind }), []);
}

export function cm6FindEngine(view: EditorView | null, hidden: HiddenSpans = noHidden): FindEngine {
	function result(state: EditorState): FindResult {
		const query = getSearchQuery(state);
		if (!query.valid) return { count: 0, active: 0, valid: query.search === "" };
		const spans = matchSpans(state, hidden);
		return { count: spans.length, active: currentSpan(state, spans), valid: true };
	}

	return {
		setQuery(query, flags) {
			if (!view) return EMPTY_RESULT;
			view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive: flags.caseSensitive, wholeWord: flags.wholeWord, regexp: flags.regex })) });
			return result(view.state);
		},
		step(direction) {
			if (!view) return EMPTY_RESULT;
			const spans = matchSpans(view.state, hidden);
			if (spans.length === 0) return result(view.state);
			const next = spans[(currentSpan(view.state, spans) + direction + spans.length) % spans.length]!;
			view.dispatch({ selection: { anchor: next.from, head: next.to }, effects: EditorView.scrollIntoView(next.from, { y: "center" }) });
			return result(view.state);
		},
		clear() {
			if (!view) return;
			view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
		},
	};
}

const REVEAL_MARGIN = 24;

export function revealRange(range: Range): void {
	const rect = range.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return;
	for (let node = range.startContainer.parentElement; node; node = node.parentElement) {
		if (node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth) continue;
		const box = node.getBoundingClientRect();
		const left = rect.left < box.left ? rect.left - box.left - REVEAL_MARGIN : rect.right > box.right ? rect.right - box.right + REVEAL_MARGIN : 0;
		const top = rect.top < box.top ? rect.top - box.top - REVEAL_MARGIN : rect.bottom > box.bottom ? rect.bottom - box.bottom + REVEAL_MARGIN : 0;
		if (left !== 0 || top !== 0) node.scrollBy({ left, top });
	}
}

const FIND_HIGHLIGHT = "find";
const FIND_ACTIVE_HIGHLIGHT = "find-active";
const WORD = /[\p{L}\p{N}_]/u;

interface FindHit {
	index: number;
	length: number;
}

function isWord(text: string, index: number): boolean {
	return index >= 0 && index < text.length && WORD.test(text.charAt(index));
}

function findHits(text: string, query: string, flags: FindFlags): FindHit[] {
	if (!query) return [];
	const hits: FindHit[] = [];
	const whole = (index: number, length: number) => !flags.wholeWord || (!isWord(text, index - 1) && !isWord(text, index + length));
	if (flags.regex) {
		const pattern = new RegExp(query, flags.caseSensitive ? "g" : "gi");
		for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
			if (match[0] === "") {
				pattern.lastIndex += 1;
				continue;
			}
			if (whole(match.index, match[0].length)) hits.push({ index: match.index, length: match[0].length });
		}
		return hits;
	}
	const haystack = flags.caseSensitive ? text : text.toLowerCase();
	const needle = flags.caseSensitive ? query : query.toLowerCase();
	for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
		if (whole(at, needle.length)) hits.push({ index: at, length: needle.length });
	}
	return hits;
}

export function domFindEngine(root: HTMLElement | null, skip: string[] = [], reveal?: (range: Range) => void): FindEngine {
	const avoided = [".float-find", ...skip];
	let query = "";
	let flags: FindFlags = { caseSensitive: false, wholeWord: false, regex: false };
	let matches: Range[] = [];
	let active = 0;
	let valid = true;

	function collect(): void {
		matches = [];
		valid = true;
		if (!root || !query) return;
		if (flags.regex) {
			try {
				new RegExp(query);
			} catch {
				valid = false;
				return;
			}
		}
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => (avoided.some((selector) => node.parentElement?.closest(selector)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
		});
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const text = node as Text;
			for (const hit of findHits(text.data, query, flags)) {
				const range = document.createRange();
				range.setStart(text, hit.index);
				range.setEnd(text, hit.index + hit.length);
				matches.push(range);
			}
		}
	}

	function repaint(): void {
		if (!root) return;
		root.style.transform = "translateZ(0)";
		requestAnimationFrame(() => root.style.removeProperty("transform"));
	}

	function paint(): void {
		if (typeof CSS === "undefined" || !CSS.highlights) return;
		const all = new Highlight();
		for (const range of matches) all.add(range);
		CSS.highlights.set(FIND_HIGHLIGHT, all);
		const current = matches[active];
		if (current) {
			const activeHighlight = new Highlight();
			activeHighlight.add(current);
			CSS.highlights.set(FIND_ACTIVE_HIGHLIGHT, activeHighlight);
		} else {
			CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT);
		}
		repaint();
	}

	function anchor(): { node: Node; offset: number } | null {
		const range = matches[active];
		if (!range || !range.startContainer.isConnected) return null;
		return { node: range.startContainer, offset: range.startOffset };
	}

	function nearest(previous: { node: Node; offset: number } | null, index: number): number {
		if (matches.length === 0) return 0;
		if (!previous) return Math.min(index, matches.length - 1);
		try {
			const probe = document.createRange();
			probe.setStart(previous.node, previous.offset);
			probe.collapse(true);
			for (let at = 0; at < matches.length; at++) {
				if (matches[at]!.compareBoundaryPoints(Range.START_TO_START, probe) >= 0) return at;
			}
		} catch {
			return Math.min(index, matches.length - 1);
		}
		return matches.length - 1;
	}

	function result(): FindResult {
		return { count: matches.length, active, valid };
	}

	return {
		setQuery(nextQuery, nextFlags) {
			const previous = anchor();
			query = nextQuery;
			flags = nextFlags;
			collect();
			active = nearest(previous, active);
			paint();
			return result();
		},
		step(direction) {
			if (matches.length === 0) return result();
			active = (active + direction + matches.length) % matches.length;
			paint();
			const range = matches[active];
			if (range) {
				if (reveal) reveal(range);
				else revealRange(range);
			}
			return result();
		},
		clear() {
			matches = [];
			valid = true;
			if (typeof CSS === "undefined" || !CSS.highlights) return;
			CSS.highlights.delete(FIND_HIGHLIGHT);
			CSS.highlights.delete(FIND_ACTIVE_HIGHLIGHT);
			repaint();
		},
	};
}

const MAX_FIND_HISTORY = 50;
const EMPTY_RESULT: FindResult = { count: 0, active: 0, valid: true };
const PLAIN_FLAGS: FindFlags = { caseSensitive: false, wholeWord: false, regex: false };
const findHistory: string[] = [];

export function useFindBar(input: { engine: () => FindEngine; canClaim?: () => boolean }): {
	open: boolean;
	props: FloatFindProps;
	claim: () => boolean;
	close: () => void;
	refresh: () => void;
} {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const engineRef = useRef<FindEngine | null>(null);
	const engineSource = useRef(input.engine);
	if (engineSource.current !== input.engine) {
		engineSource.current = input.engine;
		engineRef.current = null;
	}
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [result, setResult] = useState<FindResult>(EMPTY_RESULT);
	const historyIndex = useRef(-1);
	const historyDraft = useRef("");

	function engine(): FindEngine {
		const existing = engineRef.current;
		if (existing) return existing;
		const created = input.engine();
		engineRef.current = created;
		if (open) created.setQuery(query, PLAIN_FLAGS);
		return created;
	}

	function drop(): void {
		engineRef.current?.clear();
	}

	function search(): void {
		drop();
		if (!query.trim()) {
			setResult(EMPTY_RESULT);
			return;
		}
		setResult(engine().setQuery(query, PLAIN_FLAGS));
	}

	useEffect(() => {
		if (!open) {
			drop();
			return;
		}
		search();
	}, [open, query]);

	useEffect(() => {
		return () => {
			drop();
		};
	}, []);

	const claim = useCallback((): boolean => {
		if (input.canClaim && !input.canClaim()) return false;
		const selection = window.getSelection();
		const anchor = selection?.anchorNode ?? null;
		const fromField = anchor != null && (anchor === inputRef.current || inputRef.current?.contains(anchor) === true);
		const picked = selection && !selection.isCollapsed ? selection.toString().trim() : "";
		if (!fromField && picked.length > 0 && picked.length <= 100 && !picked.includes("\n")) {
			setQueryNow(picked);
			selection?.removeAllRanges();
		}
		setOpen(true);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
		return true;
	}, [input.canClaim]);

	const close = useCallback(() => {
		drop();
		setOpen(false);
	}, []);

	const refresh = useCallback(() => {
		if (!open) return;
		search();
	}, [open, query]);

	const step = useCallback(
		(direction: 1 | -1) => {
			const term = query.trim();
			if (!term) return;
			const existing = findHistory.indexOf(term);
			if (existing >= 0) findHistory.splice(existing, 1);
			findHistory.push(term);
			if (findHistory.length > MAX_FIND_HISTORY) findHistory.shift();
			historyIndex.current = -1;
			setResult(engine().step(direction));
		},
		[query],
	);

	function setQueryNow(value: string): void {
		setQuery(value);
		drop();
		if (!value.trim()) setResult(EMPTY_RESULT);
	}

	function recall(direction: number): void {
		if (findHistory.length === 0) return;
		if (direction < 0) {
			if (historyIndex.current === -1) {
				historyDraft.current = query;
				historyIndex.current = findHistory.length - 1;
			} else if (historyIndex.current > 0) {
				historyIndex.current -= 1;
			}
			setQueryNow(findHistory[historyIndex.current]!);
			return;
		}
		if (historyIndex.current === -1) return;
		if (historyIndex.current < findHistory.length - 1) {
			historyIndex.current += 1;
			setQueryNow(findHistory[historyIndex.current]!);
			return;
		}
		historyIndex.current = -1;
		setQueryNow(historyDraft.current);
	}

	const layerId = useId();
	useEscapeLayer({ id: `find.${layerId}`, order: ESCAPE_ORDER.floatFind, isOpen: () => open, close });

	const props: FloatFindProps = {
		query,
		result,
		inputRef,
		onQuery: (value) => {
			historyIndex.current = -1;
			setQueryNow(value);
		},
		onStep: step,
		onClose: close,
		onInputKeyDown: (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				step(event.shiftKey ? -1 : 1);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				recall(-1);
			} else if (event.key === "ArrowDown") {
				event.preventDefault();
				recall(1);
			}
		},
	};

	return { open, props, claim, close, refresh };
}
