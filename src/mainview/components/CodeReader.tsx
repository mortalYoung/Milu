import { codeFolding, foldable, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { search } from "@codemirror/search";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, GutterMarker, gutter, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { foldedSpans, searchMatchHighlighter } from "../lib/cm6-find";
import { foldLanguage } from "../lib/code-languages";
import type { RevealRange } from "../lib/dock";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { cm6FindEngine, useFindBar, useFindHandler } from "../lib/find";
import { highlightCodeToLines } from "../lib/shiki-remote";
import type { HighlightLine } from "../lib/shiki-setup";
import { setTokens, tokenPainter } from "../lib/shiki-tokens";
import { SURFACE } from "../lib/surfaces";
import { readViewState, writeViewState } from "../lib/viewstate";
import { FloatFind } from "./FloatFind";

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

const SELECTION = "color-mix(in srgb, var(--color-ink) 14%, transparent)";

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
	".cm-gutters": { background: "var(--color-surface)", border: "none", color: "var(--color-muted-soft)" },
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
		color: "var(--color-muted-soft)",
		opacity: "0",
		transition: "background-color 120ms, color 120ms",
	},
	".cm-gutters:hover .cm-fold-btn:not(.empty)": { opacity: "1" },
	".cm-gutter-cell[data-hot] .cm-fold-btn:not(.empty)": { opacity: "1" },
	".cm-gutter-cell[data-selected]": { background: SELECTION },
	".cm-fold-btn:not(.empty):hover": { background: "var(--color-hover)", color: "var(--color-ink)" },
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
		color: "var(--color-muted-soft)",
		userSelect: "none",
		cursor: "pointer",
		transition: "color 120ms",
	},
	".cm-line-no:hover": { color: "var(--color-ink)" },
	".cm-line-selected": { background: SELECTION },
	".cm-searchMatch": { background: "var(--color-find-soft)", borderRadius: "2px" },
	".cm-searchMatch-selected": { background: "var(--color-find)" },
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

export function CodeReader(props: {
	content: string;
	lang: string | null;
	fold: boolean;
	locate?: RevealRange | null;
	panelOpen: boolean;
	wrap: boolean;
	/** 这个文件在 viewstate 缓存里的键；换 tab 时靠它把现场存下来再铺回去 */
	viewKey?: string | null;
	onSelection?: (range: { start: number; end: number } | null) => void;
}) {
	const wrapCompartment = useRef(new Compartment());
	const languageCompartment = useRef(new Compartment());
	const [editor, setEditor] = useState<EditorView | null>(null);
	const [busy, setBusy] = useState(false);
	const [tokenData, setTokenData] = useState<{ content: string; lines: HighlightLine[] } | null>(null);
	const hostEl = useRef<HTMLDivElement>(null);
	const disposed = useRef(false);
	const propsRef = useRef(props);
	propsRef.current = props;
	const viewKeyRef = useRef(props.viewKey);
	viewKeyRef.current = props.viewKey;
	/* 还原现场那一帧里的 scroll 事件是"我们自己滚的"，别当成用户行为记回缓存 */
	const restoring = useRef(false);

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
				searchMatchHighlighter(foldedSpans),
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
		if (update.selectionSet || update.docChanged) {
			propsRef.current.onSelection?.(lineRange(update.state));
			save(update.view);
			return;
		}
		/* 折叠/展开既不是选区也不是 doc 变更，但它同样是"要记住的现场" */
		if (update.transactions.some((tr) => tr.effects.some((effect) => effect.is(foldEffect) || effect.is(unfoldEffect)))) save(update.view);
	}

	function lineRange(state: EditorState): { start: number; end: number } | null {
		const selection = state.selection.main;
		if (selection.empty) return null;
		return { start: state.doc.lineAt(selection.from).number - 1, end: state.doc.lineAt(selection.to).number - 1 };
	}

	function capture(view: EditorView) {
		const folds: { from: number; to: number }[] = [];
		foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
			folds.push({ from, to });
		});
		const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
		return {
			scrollTop: view.scrollDOM.scrollTop,
			lines: view.state.doc.lines,
			topLine: view.state.doc.lineAt(block.from).number,
			/* 首行顶端离视口顶还有几像素：只记行号会丢掉这半行，读起来像被吸了一下 */
			topOffset: Math.max(0, Math.round(view.scrollDOM.scrollTop - block.top)),
			select: lineRange(view.state),
			folds,
		};
	}

	function save(view: EditorView) {
		const key = viewKeyRef.current;
		/* 三条不记：空文档（换 tab 的中转帧）、正在还原的那一帧（是我们自己滚的）、
		   以及编辑器已经脱离文档时 —— 那一刻 .cm-scroller 被浏览器夹到 scrollTop 0，
		   读到的 0 不是用户的位置（P-95）。 */
		if (!key || restoring.current || view.state.doc.length === 0 || !view.dom.isConnected) return;
		writeViewState(key, capture(view));
	}

	function restore(view: EditorView, state: ReturnType<typeof capture>) {
		const lines = view.state.doc.lines;
		if (state.lines === lines) {
			// 文件没变（行数对得上）：连选中的行和折叠的块一起还
			if (state.select) {
				const from = view.state.doc.line(Math.min(state.select.start + 1, lines)).from;
				const head = view.state.doc.line(Math.min(state.select.end + 1, lines)).to;
				view.dispatch({ selection: { anchor: from, head } });
			}
			if (state.folds.length > 0) view.dispatch({ effects: state.folds.map((fold) => foldEffect.of(fold)) });
		}
		/* 滚动必须走事务（scrollIntoView），不能直接写 scrollDOM.scrollTop：
		   CM6 是虚拟视口，刚 mount / setState 时文档还没量过高度，直接写会被浏览器夹到 0
		   —— 换 tab 时 reader 是重新挂载的，这一夹就是"完全没有还原"。 */
		if (state.topLine > 0) {
			const line = view.state.doc.line(Math.min(state.topLine, lines));
			view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: state.topOffset }) });
		} else if (state.scrollTop > 0) {
			// 上一份现场是 markdown 正文写的（没有行号）：退到像素
			view.scrollDOM.scrollTop = state.scrollTop;
		}
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
		const scroller = view.scrollDOM;
		const onScroll = () => save(view);
		scroller.addEventListener("scroll", onScroll, { passive: true });
		setEditor(view);
		return () => {
			scroller.removeEventListener("scroll", onScroll);
			disposed.current = true;
			view.destroy();
		};
	}, []);

	useLayoutEffect(() => {
		const view = editor;
		if (!view) return;
		view.setState(makeState(props.content));
		const saved = props.viewKey ? readViewState(props.viewKey) : null;
		restoring.current = true;
		if (saved) restore(view, saved);
		applyLocate(view);
		const frame = requestAnimationFrame(() => {
			restoring.current = false;
		});
		return () => cancelAnimationFrame(frame);
	}, [props.content, editor, props.viewKey]);

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

	const findEngine = useCallback(() => cm6FindEngine(editor, foldedSpans), [editor]);
	const find = useFindBar({ engine: findEngine, canClaim: () => props.panelOpen && editor !== null });
	useFindHandler(SURFACE.reader, () => find.claim());

	useEffect(() => {
		if (!find.open || !editor) return;
		find.refresh();
	}, [editor, find.open, find.refresh]);

	/* 收掉 ⌘F 留下的选区 —— 只在"浮条关掉的那一刻"做。
	   editor 在依赖里会让它在每次重新挂载时也跑一遍，把刚还原回来的选区一起收掉（P-96）。 */
	const findWasOpen = useRef(false);
	useEffect(() => {
		if (find.open) {
			findWasOpen.current = true;
			return;
		}
		if (!findWasOpen.current || !editor) return;
		findWasOpen.current = false;
		editor.dispatch({ selection: { anchor: editor.state.selection.main.head } });
	}, [find.open, editor]);
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
			<div className="explorer-code-host" ref={hostEl} />
			<AnimatePresence>{find.open ? <FloatFind {...find.props} /> : null}</AnimatePresence>
			<PreviewBusy when={busy} />
		</div>
	);
}
