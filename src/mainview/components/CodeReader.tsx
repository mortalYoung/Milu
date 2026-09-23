import { codeFolding, foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { findNext, findPrevious, getSearchQuery, SearchQuery, search, setSearchQuery } from "@codemirror/search";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, GutterMarker, gutter, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { foldLanguage } from "../lib/code-languages";
import type { RevealRange } from "../lib/dock";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { highlightCodeToLines } from "../lib/shiki-remote";
import type { HighlightLine } from "../lib/shiki-setup";
import { setTokens, tokenPainter } from "../lib/shiki-tokens";

export function PreviewBusy(props: { when: boolean }) {
	return (
		<>
			{props.when && (
				<div className="explorer-busy">
					<span className="work-dot" />
					<span className="work-dot" />
					<span className="work-dot" />
				</div>
			)}
		</>
	);
}

function lineIsSelected(state: EditorState, line: { from: number; to: number }): boolean {
	const selection = state.selection.main;
	return !selection.empty && selection.from <= line.from && selection.to >= line.to;
}

function selectionBands(state: EditorState): DecorationSet {
	const selection = state.selection.main;
	if (selection.empty) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	const doc = state.doc;
	for (let number = doc.lineAt(selection.from).number; number <= doc.lineAt(selection.to).number; number++) {
		const line = doc.line(number);
		if (lineIsSelected(state, line)) builder.add(line.from, line.from, Decoration.line({ class: "cm-line-selected" }));
	}
	return builder.finish();
}

const selectionLineBands = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = selectionBands(view.state);
		}
		update(update: ViewUpdate) {
			if (update.selectionSet || update.docChanged) this.decorations = selectionBands(update.state);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

const SELECTION = "light-dark(#f2ded8, #3d2a23)";

const readerTheme = EditorView.theme({
	"&": { height: "100%" },
	"&.cm-focused": { outline: "none" },
	".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "var(--explorer-line-height, 1.2)" },
	".cm-content": { padding: "0" },
	".cm-line": { padding: "0", minHeight: "var(--explorer-line-height-em, 1.2em)" },
	"&.cm-focused .cm-selectionBackground, & .cm-selectionBackground": { backgroundColor: SELECTION },
	"&.cm-editor .cm-scroller .cm-content::selection, &.cm-editor .cm-scroller .cm-content ::selection, &.cm-editor.cm-focused .cm-scroller .cm-content ::selection": {
		background: "transparent !important",
		color: "inherit !important",
	},
	".cm-cursor, .cm-dropCursor": { display: "none" },
	".cm-foldPlaceholder": { display: "none" },
	".cm-gutters": { background: "var(--color-letter)", border: "none", color: "var(--color-muted)" },
	".cm-gutters.cm-gutters-before": { borderRightWidth: "0" },
	".cm-line-gutter .cm-gutterElement": { padding: "0" },
	".cm-gutter-cell": { display: "flex", alignItems: "flex-start", height: "100%" },
	".cm-fold-btn": {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: "18px",
		height: "18px",
		flex: "none",
		padding: "0",
		border: "0",
		borderRadius: "3px",
		background: "transparent",
		color: "var(--color-muted)",
		opacity: "0",
		transition: "background-color 120ms, color 120ms",
	},
	".cm-gutters:hover .cm-fold-btn:not(.empty)": { opacity: "1" },
	".cm-gutter-cell[data-hot] .cm-fold-btn:not(.empty)": { opacity: "1" },
	".cm-gutter-cell[data-selected]": { background: SELECTION },
	".cm-fold-btn:not(.empty):hover": { background: "var(--color-paper-hover)", color: "var(--color-ink)" },
	".cm-fold-btn:focus-visible": { opacity: "1", outline: "2px solid var(--color-ring)", outlineOffset: "-2px" },
	".cm-fold-btn svg": { width: "12px", height: "12px" },
	".cm-line-no": {
		width: "5.5ch",
		flex: "none",
		padding: "0",
		border: "0",
		background: "transparent",
		textAlign: "center",
		fontFamily: "var(--font-mono)",
		fontSize: "12px",
		lineHeight: "var(--explorer-line-height, 1.2)",
		color: "var(--color-muted)",
		userSelect: "none",
		cursor: "pointer",
		transition: "color 120ms",
	},
	".cm-line-no:hover": { color: "var(--color-ink)" },
	".cm-line-selected": { background: SELECTION },
	".cm-searchMatch": { background: "color-mix(in srgb, var(--color-seal) 26%, transparent)", borderRadius: "2px" },
	".cm-searchMatch-selected": { background: "color-mix(in srgb, var(--color-seal) 60%, transparent)" },
});

function foldedAt(view: EditorView, line: { from: number; to: number }): { from: number; to: number } | null {
	let folded: { from: number; to: number } | null = null;
	foldedRanges(view.state).between(line.from, Math.min(line.to + 1, view.state.doc.length), (from, to) => {
		folded ??= { from, to };
	});
	return folded;
}

class LineMarker extends GutterMarker {
	constructor(
		readonly number: number,
		readonly canFold: boolean,
		readonly folded: boolean,
		readonly selected: boolean,
	) {
		super();
	}

	toDOM() {
		const cell = document.createElement("span");
		cell.className = "cm-gutter-cell";
		cell.dataset["line"] = String(this.number);
		if (this.selected) cell.dataset["selected"] = "";

		const fold = document.createElement("button");
		fold.type = "button";
		fold.className = `cm-fold-btn${this.canFold ? (this.folded ? " open" : "") : " empty"}`;
		if (this.canFold) {
			fold.setAttribute("aria-label", this.folded ? "Expand block" : "Collapse block");
			fold.innerHTML = this.folded ? CHEVRON_RIGHT : CHEVRON_DOWN;
		} else {
			fold.tabIndex = -1;
		}
		const number = document.createElement("button");
		number.type = "button";
		number.className = "cm-line-no";
		number.textContent = String(this.number);
		number.setAttribute("aria-label", `Select line ${this.number}`);
		cell.append(fold, number);
		return cell;
	}
}

const hoveredLine = ViewPlugin.fromClass(
	class {
		hot: HTMLElement | null = null;

		constructor(readonly view: EditorView) {
			this.onMove = this.onMove.bind(this);
			view.dom.addEventListener("mousemove", this.onMove);
		}

		onMove(event: MouseEvent) {
			const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
			const line = pos == null ? null : this.view.state.doc.lineAt(pos).number;
			const cell = line == null ? null : this.view.dom.querySelector<HTMLElement>(`.cm-gutter-cell[data-line="${line}"]`);
			if (cell === this.hot) return;
			this.hot?.removeAttribute("data-hot");
			cell?.setAttribute("data-hot", "");
			this.hot = cell;
		}

		destroy() {
			this.view.dom.removeEventListener("mousemove", this.onMove);
			this.hot?.removeAttribute("data-hot");
		}
	},
);

function readerGutter() {
	return gutter({
		class: "cm-line-gutter",
		lineMarker: (view, line) => {
			const number = view.state.doc.lineAt(line.from).number;
			const folded = foldedAt(view, line);
			const fold = folded ?? foldable(view.state, line.from, line.to);
			return new LineMarker(number, fold != null, folded != null, lineIsSelected(view.state, line));
		},
		domEventHandlers: {
			mousedown(view, line, event) {
				const target = event.target as HTMLElement | null;
				const folded = foldedAt(view, line);
				const fold = folded ?? foldable(view.state, line.from, line.to);
				if (target?.closest(".cm-fold-btn") && fold) {
					view.dispatch({ effects: folded ? unfoldEffect.of(fold) : foldEffect.of(fold) });
					return true;
				}
				if (!target?.closest(".cm-line-no")) return false;
				const shift = event instanceof MouseEvent && event.shiftKey;
				const doc = view.state.doc;
				const selection = view.state.selection.main;
				const number = doc.lineAt(line.from).number;
				const anchor = shift && !selection.empty ? doc.lineAt(selection.anchor).number : number;
				const from = Math.min(anchor, number);
				const to = Math.max(anchor, number);
				view.dispatch({ selection: { anchor: doc.line(from).from, head: doc.line(to).to } });
				view.focus();
				return true;
			},
		},
	});
}

const findHistory: string[] = [];
const MAX_FIND_HISTORY = 50;

interface FindMatchRange {
	start: number;
	end: number;
}

export function CodeReader(props: {
	content: string;
	lang: string | null;
	fold: boolean;
	locate?: RevealRange | null;
	metrics: string;
	panelOpen: boolean;
	wrap: boolean;
	onSelection?: (range: { start: number; end: number } | null) => void;
}) {
	const wrapCompartment = useRef(new Compartment());
	const languageCompartment = useRef(new Compartment());
	const [editor, setEditor] = useState<EditorView | null>(null);
	const [busy, setBusy] = useState(false);
	const [matches, setMatches] = useState(0);
	const [activeMatch, setActiveMatch] = useState(0);
	const [tokenData, setTokenData] = useState<{ content: string; lines: HighlightLine[] } | null>(null);
	const hostEl = useRef<HTMLDivElement>(null);
	const findInputEl = useRef<HTMLInputElement>(null);
	const disposed = useRef(false);
	const historyIndex = useRef(-1);
	const historyDraft = useRef("");
	const propsRef = useRef(props);
	propsRef.current = props;

	const [findOpen, setFindOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [wholeWord, setWholeWord] = useState(false);
	const [useRegex, setUseRegex] = useState(false);

	const currentQuery = new SearchQuery({ search: findOpen ? query : "", caseSensitive, wholeWord, regexp: useRegex });

	useEffect(() => {
		if (props.content === "") {
			setTokenData(null);
			setBusy(false);
			return;
		}
		let cancelled = false;
		setBusy(true);
		void highlightCodeToLines(props.content, props.lang)
			.then((lines) => {
				if (cancelled) return;
				setTokenData({ content: props.content, lines });
				setBusy(false);
			})
			.catch(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [props.content, props.lang]);

	function makeState(content: string): EditorState {
		return EditorState.create({
			doc: content,
			extensions: [
				readerTheme,
				EditorState.readOnly.of(true),
				EditorView.editable.of(false),
				drawSelection(),
				EditorView.updateListener.of(reportSelection),
				tokenPainter(),
				selectionLineBands,
				readerGutter(),
				hoveredLine,
				codeFolding(),
				search(),
				wrapCompartment.current.of(propsRef.current.wrap ? EditorView.lineWrapping : []),
				languageCompartment.current.of([]),
				keymap.of([
					{
						key: "Mod-a",
						run: (view) => {
							view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
							return true;
						},
					},
				]),
			],
		});
	}

	function reportSelection(update: ViewUpdate) {
		if (!update.selectionSet && !update.docChanged) return;
		propsRef.current.onSelection?.(lineRange(update.state));
	}

	function lineRange(state: EditorState): { start: number; end: number } | null {
		const selection = state.selection.main;
		if (selection.empty) return null;
		return { start: state.doc.lineAt(selection.from).number - 1, end: state.doc.lineAt(selection.to).number - 1 };
	}

	function applyLocate(view: EditorView) {
		const target = propsRef.current.locate;
		if (!target) return;
		const doc = view.state.doc;
		if (target.start > doc.lines) return;
		const from = doc.line(Math.min(target.start, doc.lines)).from;
		const head = doc.line(Math.min(target.end, doc.lines)).to;
		view.dispatch({ selection: { anchor: from, head }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
	}

	useEffect(() => {
		const el = hostEl.current;
		if (!el) return;
		const view = new EditorView({ state: makeState(propsRef.current.content), parent: el });
		setEditor(view);
		return () => {
			disposed.current = true;
			view.destroy();
		};
	}, []);

	useEffect(() => {
		const view = editor;
		if (!view) return;
		view.setState(makeState(props.content));
		applyLocate(view);
	}, [props.content, editor]);

	useEffect(() => {
		if (!editor) return;
		editor.dispatch({ effects: wrapCompartment.current.reconfigure(props.wrap ? EditorView.lineWrapping : []) });
	}, [props.wrap, editor]);

	useEffect(() => {
		const view = editor;
		if (!view) return;
		const lang = props.lang;
		void (async () => {
			const language = props.fold ? await foldLanguage(lang).catch(() => null) : null;
			if (disposed.current || propsRef.current.lang !== lang) return;
			view.dispatch({ effects: languageCompartment.current.reconfigure(language ?? []) });
		})();
	}, [props.lang, props.fold, editor]);

	useEffect(() => {
		const view = editor;
		if (!view) return;
		view.dispatch({ effects: setTokens.of(tokenData ? { content: tokenData.content, lines: tokenData.lines } : null) });
	}, [tokenData, editor]);

	useEffect(() => {
		if (!editor || !props.locate) return;
		applyLocate(editor);
	}, [props.locate, editor]);

	useEffect(() => {
		const view = editor;
		if (!view) return;
		const onSelectionChange = () => {
			if (!view.hasFocus) return;
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
			if (selection.getRangeAt(0).commonAncestorContainer !== document.body) return;
			selection.removeAllRanges();
			view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
		};
		document.addEventListener("selectionchange", onSelectionChange);
		return () => document.removeEventListener("selectionchange", onSelectionChange);
	}, [editor]);

	function pushQuery(view: EditorView) {
		view.dispatch({ effects: setSearchQuery.of(currentQuery) });
		refreshMatches(view);
	}

	function matchRanges(view: EditorView): FindMatchRange[] {
		const cursor = getSearchQuery(view.state).getCursor(view.state);
		if (!cursor) return [];
		const ranges: FindMatchRange[] = [];
		for (let next = cursor.next(); !next.done; next = cursor.next()) ranges.push({ start: next.value.from, end: next.value.to });
		return ranges;
	}

	function refreshMatches(view: EditorView) {
		const ranges = matchRanges(view);
		setMatches(ranges.length);
		const selection = view.state.selection.main;
		const index = ranges.findIndex((range) => range.start <= selection.from && range.end >= selection.from);
		setActiveMatch(index < 0 ? 0 : index);
	}

	useEffect(() => {
		if (!editor) return;
		pushQuery(editor);
	}, [query, caseSensitive, wholeWord, useRegex, editor]);

	function openFind() {
		historyIndex.current = -1;
		const view = editor;
		if (view) {
			const selection = view.state.selection.main;
			const picked = selection.empty ? "" : view.state.sliceDoc(selection.from, selection.to).trim();
			if (picked && !picked.includes("\n")) setQuery(picked);
		}
		setFindOpen(true);
		requestAnimationFrame(() => {
			findInputEl.current?.focus();
			findInputEl.current?.select();
		});
	}

	function closeFind() {
		setFindOpen(false);
	}

	function commitHistory() {
		const term = query.trim();
		if (!term) return;
		const existing = findHistory.indexOf(term);
		if (existing >= 0) findHistory.splice(existing, 1);
		findHistory.push(term);
		if (findHistory.length > MAX_FIND_HISTORY) findHistory.shift();
		historyIndex.current = -1;
	}

	function recallHistory(direction: number) {
		if (findHistory.length === 0) return;
		if (direction < 0) {
			if (historyIndex.current === -1) {
				historyDraft.current = query;
				historyIndex.current = findHistory.length - 1;
			} else if (historyIndex.current > 0) {
				historyIndex.current -= 1;
			}
			setQuery(findHistory[historyIndex.current]!);
		} else if (historyIndex.current !== -1) {
			if (historyIndex.current < findHistory.length - 1) {
				historyIndex.current += 1;
				setQuery(findHistory[historyIndex.current]!);
			} else {
				historyIndex.current = -1;
				setQuery(historyDraft.current);
			}
		}
	}

	function stepMatch(direction: number) {
		const view = editor;
		if (!view) return;
		commitHistory();
		if (matchRanges(view).length === 0) return;
		if (direction > 0) findNext(view);
		else findPrevious(view);
		refreshMatches(view);
	}

	const findCountLabel = (() => {
		if (!query) return "";
		if (!currentQuery.valid || matches === 0) return "No results";
		return `${activeMatch + 1} of ${matches}`;
	})();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
			const active = document.activeElement as HTMLElement | null;
			if (active && active !== findInputEl.current && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
			event.preventDefault();
			openFind();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [editor]);

	useEscapeLayer({
		id: "explorer.readerFind",
		order: ESCAPE_ORDER.readerFind,
		isOpen: () => props.panelOpen && findOpen,
		close: () => closeFind(),
	});
	useEscapeLayer({
		id: "explorer.readerSelection",
		order: ESCAPE_ORDER.readerSelection,
		isOpen: () => props.panelOpen && editor?.state.selection.main.empty === false,
		close: () => {
			const view = editor;
			if (!view) return;
			view.dispatch({ selection: { anchor: view.state.selection.main.head } });
		},
	});

	return (
		<div className="explorer-code-pane">
			<div className="explorer-reader-tools" role="search" aria-label="Find in file">
				{findOpen ? (
					<>
						<input
							ref={findInputEl}
							className={"explorer-find-input" + (currentQuery.valid ? "" : " invalid")}
							placeholder="Find"
							aria-label="Find"
							autoComplete="off"
							autoCapitalize="off"
							spellCheck={false}
							value={query}
							onChange={(event) => {
								historyIndex.current = -1;
								setQuery(event.currentTarget.value);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									stepMatch(event.shiftKey ? -1 : 1);
								} else if (event.key === "ArrowUp") {
									event.preventDefault();
									recallHistory(-1);
								} else if (event.key === "ArrowDown") {
									event.preventDefault();
									recallHistory(1);
								}
							}}
						/>
						<button
							type="button"
							className={"explorer-find-toggle" + (caseSensitive ? " on" : "")}
							title="Match Case"
							aria-label="Match case"
							aria-pressed={caseSensitive}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => setCaseSensitive((value) => !value)}
						>
							<CaseSensitive size={13} />
						</button>
						<button
							type="button"
							className={"explorer-find-toggle" + (wholeWord ? " on" : "")}
							title="Match Whole Word"
							aria-label="Match whole word"
							aria-pressed={wholeWord}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => setWholeWord((value) => !value)}
						>
							<WholeWord size={13} />
						</button>
						<button
							type="button"
							className={"explorer-find-toggle" + (useRegex ? " on" : "") + (currentQuery.valid ? "" : " error")}
							title="Use Regular Expression"
							aria-label="Use regular expression"
							aria-pressed={useRegex}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => setUseRegex((value) => !value)}
						>
							<Regex size={13} />
						</button>
						<span className="explorer-find-count" aria-live="polite">
							{findCountLabel}
						</span>
						<button
							type="button"
							className="explorer-find-nav"
							title="Previous Match (Shift+Enter)"
							aria-label="Previous match"
							disabled={matches === 0}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => stepMatch(-1)}
						>
							<ChevronUp size={14} />
						</button>
						<button
							type="button"
							className="explorer-find-nav"
							title="Next Match (Enter)"
							aria-label="Next match"
							disabled={matches === 0}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => stepMatch(1)}
						>
							<ChevronDown size={14} />
						</button>
						<button type="button" className="explorer-find-close" title="Close (Esc)" aria-label="Close find" onClick={closeFind}>
							<X size={14} />
						</button>
					</>
				) : (
					<button type="button" className="explorer-tool" title="Find in file (⌘F)" aria-label="Find in file" onClick={openFind}>
						⌕
					</button>
				)}
				<span className="explorer-metrics">{props.metrics}</span>
			</div>
			<div className="explorer-code-host" ref={hostEl} />
			<PreviewBusy when={busy} />
		</div>
	);
}
