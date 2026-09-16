import { codeFolding, foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { findNext, findPrevious, getSearchQuery, SearchQuery, search, setSearchQuery } from "@codemirror/search";
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, GutterMarker, gutter, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show, untrack } from "solid-js";
import { foldLanguage } from "../lib/code-languages";
import type { RevealRange } from "../lib/dock";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { type HighlightLine, highlightCodeToLines } from "../lib/markdown";

/** The preview is already readable while the highlighter works; the pill only fades in if the
 * upgrade takes longer than a beat, so small files never flash it. */
export function PreviewBusy(props: { when: boolean }) {
	return (
		<Show when={props.when}>
			<div class="explorer-busy">
				<span class="work-dot" />
				<span class="work-dot" />
				<span class="work-dot" />
			</div>
		</Show>
	);
}

// ——— shiki → CodeMirror: colours as decorations, so a re-highlight never costs the selection ———

const setTokens = StateEffect.define<{ content: string; lines: HighlightLine[] } | null>();

function tokenDecorations(content: string, lines: HighlightLine[], doc: EditorState["doc"]): DecorationSet {
	// A token set that does not belong to the text in the editor is a file we already left.
	if (doc.toString() !== content) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	let skipped = false;
	for (let index = 0; index < lines.length && !skipped; index++) {
		if (index + 1 > doc.lines) break;
		const line = doc.line(index + 1);
		let offset = 0;
		for (const token of lines[index].tokens) {
			const from = line.from + offset;
			offset += token.content.length;
			if (offset > line.length) {
				skipped = true;
				break;
			}
			if (!token.htmlStyle || offset === from - line.from) continue;
			const style = Object.entries(token.htmlStyle)
				.map(([key, value]) => `${key}: ${value}`)
				.join("; ");
			builder.add(from, line.from + offset, Decoration.mark({ attributes: { style } }));
		}
	}
	return builder.finish();
}

const tokenField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, transaction) {
		let next = decorations;
		for (const effect of transaction.effects) {
			if (effect.is(setTokens)) next = effect.value ? tokenDecorations(effect.value.content, effect.value.lines, transaction.state.doc) : Decoration.none;
		}
		return transaction.docChanged ? next.map(transaction.changes) : next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/** Lines that the selection covers whole are the reader's "these lines" — the row selection. */
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

// ——— the gutter: fold button, then line number, on one line of the old reader ———

const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

/** The reader's selection wash: `--color-seal` at 16% over `--color-letter`, written out. */
const SELECTION = "light-dark(#f2ded8, #3d2a23)";

/**
 * The reader's skin. It has to be a CodeMirror theme rather than style.css: CodeMirror mounts its own
 * theme into `<head>` at runtime, after the app's stylesheet, so a rule of equal specificity written
 * in style.css loses — the gutter keeps its grey, the selection keeps its blue, the line keeps its 6px
 * padding. Anything CodeMirror also styles belongs here; the shell around the editor (host, tools row,
 * find row, busy pill) stays in style.css.
 */
const readerTheme = EditorView.theme({
	"&": { height: "100%" },
	"&.cm-focused": { outline: "none" },
	".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "var(--explorer-line-height, 1.2)" },
	".cm-content": { padding: "0" },
	".cm-line": { padding: "0", minHeight: "var(--explorer-line-height-em, 1.2em)" },
	// `drawSelection()` paints the selection, so it looks the same focused or not and never takes an OS
	// colour. The browser's own selection stays in the DOM (copy needs it) but is painted with nothing: a
	// theme key is prefixed with the theme class — which sits on the editor *root* — so these steps have to
	// be real descendants, and the extra class is what outranks `hideNativeSelection`'s
	// `Highlight !important` (the system highlight colour). `color: inherit` keeps the syntax colour.
	// The wash is written out rather than mixed: a selection is not the place to depend on mixing.
	"&.cm-focused .cm-selectionBackground, & .cm-selectionBackground": { backgroundColor: SELECTION },
	"&.cm-editor .cm-scroller .cm-content::selection, &.cm-editor .cm-scroller .cm-content ::selection, &.cm-editor.cm-focused .cm-scroller .cm-content ::selection": {
		background: "transparent !important",
		color: "inherit !important",
	},
	// Read-only: there is nowhere to type, so no caret to show.
	".cm-cursor, .cm-dropCursor": { display: "none" },
	// The app's global `::selection` reads two variables; `.cm-editor` re-points them (see style.css).
	//
	// A folded block collapses to nothing, the way the hand-rolled reader did.
	".cm-foldPlaceholder": { display: "none" },
	// The gutter has to be opaque: it stays put while the code scrolls under it horizontally, and a
	// transparent gutter shows the scrolled text through the line numbers.
	".cm-gutters": { background: "var(--color-letter)", border: "none", color: "var(--color-muted)" },
	".cm-gutters.cm-gutters-before": { borderRightWidth: "0" },
	".cm-line-gutter .cm-gutterElement": { padding: "0" },
	// One gutter cell per line: fold button, then line number, in the order they have always been in —
	// and pinned to the top of the line, because a wrapped line is several rows tall and the number
	// belongs on the first one.
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
	// The gutter is where you go looking for fold buttons; hovering a line reveals its own, gutter and
	// text being two columns CodeMirror keeps apart.
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
	// The whole-line band carries the same wash as the characters: a line selection is one colour across
	// the line, not a wash sitting on a different band (the old `--color-paper-hover` row highlight).
	".cm-line-selected": { background: SELECTION },
	".cm-searchMatch": { background: "color-mix(in srgb, var(--color-seal) 26%, transparent)", borderRadius: "2px" },
	".cm-searchMatch-selected": { background: "color-mix(in srgb, var(--color-seal) 60%, transparent)" },
});

/**
 * The collapsed range covering this line, if this line is folded. A folded region is replaced in the
 * view, so `foldable` cannot speak for it — it answers from the syntax tree. Asking the folded ranges
 * first is what keeps the chevron on screen (as the "open" one) the moment a block is folded; without
 * it the marker goes back to "empty", stays invisible, and there is no way to unfold.
 */
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
		// The row band runs across the number as well: the band used to live inside the line, numbers
		// and all.
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

/** Hovering a line has to reveal its own fold button, and the gutter and the text are two columns. */
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
				// Clicking a number takes that line; shift extends from the anchor line, as everywhere else.
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

/**
 * The code reader: CodeMirror draws and measures, shiki keeps the colours, the house keeps the
 * furniture (find row, metrics, stamp, Quote, Raw). Read-only — this reader is for reading.
 */
export function CodeReader(props: {
	content: string;
	lang: string | null;
	fold: boolean;
	locate?: RevealRange | null;
	metrics: string;
	/** The panel this reader belongs to is showing, so its Esc layers are live. */
	panelOpen: boolean;
	wrap: boolean;
	onSelection?: (range: { start: number; end: number } | null) => void;
}) {
	const wrapCompartment = new Compartment();
	const languageCompartment = new Compartment();
	const [editor, setEditor] = createSignal<EditorView | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [matches, setMatches] = createSignal(0);
	const [activeMatch, setActiveMatch] = createSignal(0);
	let hostEl: HTMLDivElement | undefined;
	let disposed = false;

	const [tokenData] = createResource(
		() => ({ content: props.content, lang: props.lang }),
		async (key) => ({ content: key.content, lines: await highlightCodeToLines(key.content, key.lang) }),
	);

	createEffect(() => {
		setBusy(tokenData.loading && props.content !== "");
	});

	function makeState(content: string): EditorState {
		return EditorState.create({
			doc: content,
			extensions: [
				readerTheme,
				EditorState.readOnly.of(true),
				EditorView.editable.of(false),
				drawSelection(),
				EditorView.updateListener.of(reportSelection),
				Prec.lowest(tokenField),
				selectionLineBands,
				readerGutter(),
				hoveredLine,
				codeFolding(),
				search(),
				wrapCompartment.of(untrack(() => props.wrap) ? EditorView.lineWrapping : []),
				languageCompartment.of([]),
				// The one chord the reader owns: CodeMirror ships no keymap here, so without this ⌘A would fall
				// through to the browser and select the page instead of the file.
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
		props.onSelection?.(lineRange(update.state));
	}

	function lineRange(state: EditorState): { start: number; end: number } | null {
		const selection = state.selection.main;
		if (selection.empty) return null;
		return { start: state.doc.lineAt(selection.from).number - 1, end: state.doc.lineAt(selection.to).number - 1 };
	}

	// ——— mount ———
	createEffect(() => {
		const el = hostEl;
		if (!el) return;
		const view = new EditorView({ state: makeState(untrack(() => props.content)), parent: el });
		setEditor(view);
		onCleanup(() => {
			disposed = true;
			view.destroy();
		});
	});

	// ——— a different file is a different state ———
	createEffect(() => {
		const content = props.content;
		const view = editor();
		if (!view) return;
		view.setState(makeState(content));
		// A fresh state has no selection: the reveal this file was opened with has to be put back.
		applyLocate(view);
	});

	createEffect(() => {
		const view = editor();
		if (!view) return;
		view.dispatch({ effects: wrapCompartment.reconfigure(props.wrap ? EditorView.lineWrapping : []) });
	});

	createEffect(() => {
		const lang = props.lang;
		const folding = props.fold;
		const view = editor();
		if (!view) return;
		void (async () => {
			const language = folding ? await foldLanguage(lang).catch(() => null) : null;
			if (disposed || props.lang !== lang) return;
			view.dispatch({ effects: languageCompartment.reconfigure(language ?? []) });
		})();
	});

	createEffect(() => {
		const data = tokenData();
		const view = editor();
		if (!view) return;
		view.dispatch({ effects: setTokens.of(data ? { content: data.content, lines: data.lines } : null) });
	});

	function applyLocate(view: EditorView) {
		const target = untrack(() => props.locate);
		if (!target) return;
		const doc = view.state.doc;
		if (target.start > doc.lines) return;
		const from = doc.line(Math.min(target.start, doc.lines)).from;
		const head = doc.line(Math.min(target.end, doc.lines)).to;
		view.dispatch({ selection: { anchor: from, head }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
	}

	createEffect(() => {
		const target = props.locate;
		const view = editor();
		if (!view || !target) return;
		applyLocate(view);
	});

	// ——— find in file: the row is ours, the matching and the highlight are CodeMirror's ———
	const [findOpen, setFindOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [caseSensitive, setCaseSensitive] = createSignal(false);
	const [wholeWord, setWholeWord] = createSignal(false);
	const [useRegex, setUseRegex] = createSignal(false);
	let findInputEl: HTMLInputElement | undefined;
	let historyIndex = -1;
	let historyDraft = "";

	const currentQuery = createMemo(() => new SearchQuery({ search: findOpen() ? query() : "", caseSensitive: caseSensitive(), wholeWord: wholeWord(), regexp: useRegex() }));

	function pushQuery(view: EditorView) {
		view.dispatch({ effects: setSearchQuery.of(currentQuery()) });
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
		// Only the query and a navigation step need this walk; a drag must not count every match.
		const ranges = matchRanges(view);
		setMatches(ranges.length);
		const selection = view.state.selection.main;
		const index = ranges.findIndex((range) => range.start <= selection.from && range.end >= selection.from);
		setActiveMatch(index < 0 ? 0 : index);
	}

	createEffect(() => {
		const view = editor();
		void query();
		void caseSensitive();
		void wholeWord();
		void useRegex();
		if (!view) return;
		pushQuery(view);
	});

	function openFind() {
		historyIndex = -1;
		const view = editor();
		if (view) {
			const selection = view.state.selection.main;
			const picked = selection.empty ? "" : view.state.sliceDoc(selection.from, selection.to).trim();
			if (picked && !picked.includes("\n")) setQuery(picked);
		}
		setFindOpen(true);
		requestAnimationFrame(() => {
			findInputEl?.focus();
			findInputEl?.select();
		});
	}

	function closeFind() {
		setFindOpen(false);
	}

	function commitHistory() {
		const term = query().trim();
		if (!term) return;
		const existing = findHistory.indexOf(term);
		if (existing >= 0) findHistory.splice(existing, 1);
		findHistory.push(term);
		if (findHistory.length > MAX_FIND_HISTORY) findHistory.shift();
		historyIndex = -1;
	}

	function recallHistory(direction: number) {
		if (findHistory.length === 0) return;
		if (direction < 0) {
			if (historyIndex === -1) {
				historyDraft = query();
				historyIndex = findHistory.length - 1;
			} else if (historyIndex > 0) {
				historyIndex -= 1;
			}
			setQuery(findHistory[historyIndex]);
		} else if (historyIndex !== -1) {
			if (historyIndex < findHistory.length - 1) {
				historyIndex += 1;
				setQuery(findHistory[historyIndex]);
			} else {
				historyIndex = -1;
				setQuery(historyDraft);
			}
		}
	}

	function stepMatch(direction: number) {
		const view = editor();
		if (!view) return;
		commitHistory();
		if (matchRanges(view).length === 0) return;
		if (direction > 0) findNext(view);
		else findPrevious(view);
		refreshMatches(view);
	}

	const findCountLabel = () => {
		if (!query()) return "";
		if (!currentQuery().valid || matches() === 0) return "No results";
		return `${activeMatch() + 1} of ${matches()}`;
	};

	createEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
			const active = document.activeElement as HTMLElement | null;
			if (active && active !== findInputEl && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
			event.preventDefault();
			openFind();
		};
		window.addEventListener("keydown", onKeyDown);
		onCleanup(() => window.removeEventListener("keydown", onKeyDown));
	});

	// ——— Esc layers of this reader: the find row over a line selection, both over the file itself ———
	useEscapeLayer({
		id: "explorer.readerFind",
		order: ESCAPE_ORDER.readerFind,
		isOpen: () => props.panelOpen && findOpen(),
		close: () => closeFind(),
	});
	useEscapeLayer({
		id: "explorer.readerSelection",
		order: ESCAPE_ORDER.readerSelection,
		isOpen: () => props.panelOpen && editor()?.state.selection.main.empty === false,
		close: () => {
			const view = editor();
			if (!view) return;
			view.dispatch({ selection: { anchor: view.state.selection.main.head } });
		},
	});

	return (
		<div class="explorer-code-pane">
			<div class="explorer-reader-tools" role="search" aria-label="Find in file">
				<Show
					when={findOpen()}
					fallback={
						<button type="button" class="explorer-tool" title="Find in file (⌘F)" aria-label="Find in file" onClick={openFind}>
							⌕
						</button>
					}
				>
					<input
						ref={findInputEl}
						class={"explorer-find-input" + (currentQuery().valid ? "" : " invalid")}
						placeholder="Find"
						aria-label="Find"
						autocomplete="off"
						autocapitalize="off"
						spellcheck={false}
						value={query()}
						onInput={(event) => {
							historyIndex = -1;
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
						class={"explorer-find-toggle" + (caseSensitive() ? " on" : "")}
						title="Match Case"
						aria-label="Match case"
						aria-pressed={caseSensitive()}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => setCaseSensitive((value) => !value)}
					>
						<CaseSensitive size={13} />
					</button>
					<button
						type="button"
						class={"explorer-find-toggle" + (wholeWord() ? " on" : "")}
						title="Match Whole Word"
						aria-label="Match whole word"
						aria-pressed={wholeWord()}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => setWholeWord((value) => !value)}
					>
						<WholeWord size={13} />
					</button>
					<button
						type="button"
						class={"explorer-find-toggle" + (useRegex() ? " on" : "") + (currentQuery().valid ? "" : " error")}
						title="Use Regular Expression"
						aria-label="Use regular expression"
						aria-pressed={useRegex()}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => setUseRegex((value) => !value)}
					>
						<Regex size={13} />
					</button>
					<span class="explorer-find-count" aria-live="polite">
						{findCountLabel()}
					</span>
					<button
						type="button"
						class="explorer-find-nav"
						title="Previous Match (Shift+Enter)"
						aria-label="Previous match"
						disabled={matches() === 0}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => stepMatch(-1)}
					>
						<ChevronUp size={14} />
					</button>
					<button
						type="button"
						class="explorer-find-nav"
						title="Next Match (Enter)"
						aria-label="Next match"
						disabled={matches() === 0}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => stepMatch(1)}
					>
						<ChevronDown size={14} />
					</button>
					<button type="button" class="explorer-find-close" title="Close (Esc)" aria-label="Close find" onClick={closeFind}>
						<X size={14} />
					</button>
				</Show>
				<span class="explorer-metrics">{props.metrics}</span>
			</div>
			<div class="explorer-code-host" ref={hostEl} />
			<PreviewBusy when={busy()} />
		</div>
	);
}
