import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, lineNumbers } from "@codemirror/view";
import { createEffect, onCleanup, untrack } from "solid-js";
import { highlightCodeToLines } from "../lib/markdown";
import { setTokens, tokenPainter } from "../lib/shiki-tokens";

/** The reader's selection wash, written out the same way: a selection is not the place to mix. */
const SELECTION = "light-dark(#f2ded8, #3d2a23)";
/** One line of change, and one exact character of it: a wash for the eye, more of it for the word. */
const ADD_LINE = "color-mix(in srgb, var(--git-add) 10%, transparent)";
const DEL_LINE = "color-mix(in srgb, var(--git-del) 10%, transparent)";
const ADD_TEXT = "color-mix(in srgb, var(--git-add) 24%, transparent)";
const DEL_TEXT = "color-mix(in srgb, var(--git-del) 24%, transparent)";

/**
 * The reader's fold chevron, for the collapsed region: a right chevron means "click and this opens", the
 * same thing it means in the reader's gutter. It has to come from CSS — the label of that band is a text
 * node the library builds itself — so it is masked rather than inlined, which also lets it take the
 * label's colour.
 */
const EXPAND_ICON =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E\")";

/**
 * The diff's skin. Like the reader's it has to be a CodeMirror theme rather than style.css: CodeMirror
 * mounts its own theme after the app's stylesheet, so a rule of equal specificity there loses (P-66).
 *
 * A change is told three times, the way every git surface tells it: the line's wash, the exact
 * characters, the bar in the gutter. Red is the old side and green the new one — the classes carry
 * which side they sit on (`cm-merge-a` is the original), so no colour is ever shared between them.
 */
const diffTheme = EditorView.theme({
	"&": { height: "100%" },
	"&.cm-focused": { outline: "none" },
	".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "var(--explorer-line-height, 1.2)" },
	".cm-content": { padding: "0" },
	".cm-line": { padding: "0", minHeight: "var(--explorer-line-height-em, 1.2em)" },
	// The old side ends on a hairline, so the two columns read as two.
	"&.cm-merge-a": { borderRight: "1px solid var(--color-hairline)" },
	// A diff is read *by* selecting from it. CodeMirror paints the selection itself, so both the layer and
	// the native path have to be told — the app neutralises `::selection` inside every `.cm-editor`.
	"&.cm-focused .cm-selectionBackground, & .cm-selectionBackground": { backgroundColor: SELECTION },
	"&.cm-editor .cm-scroller .cm-content::selection, &.cm-editor .cm-scroller .cm-content ::selection, &.cm-editor.cm-focused .cm-scroller .cm-content ::selection": {
		background: "transparent !important",
		color: "inherit !important",
	},
	// Read-only: no caret, and the gutter keeps the reader's paper rather than CodeMirror's grey.
	".cm-cursor, .cm-dropCursor": { display: "none" },
	".cm-gutters": { background: "var(--color-letter)", border: "none", color: "var(--color-muted)" },
	".cm-gutters.cm-gutters-before": { borderRightWidth: "0" },
	".cm-lineNumbers .cm-gutterElement": {
		padding: "0 7px 0 6px",
		minWidth: "20px",
		textAlign: "right",
		whiteSpace: "nowrap",
		userSelect: "none",
		fontVariantNumeric: "tabular-nums",
	},
	// ——— the change, in three levels: the line, the characters, the bar ———
	"&.cm-merge-a .cm-changedLine": { backgroundColor: DEL_LINE },
	"&.cm-merge-b .cm-changedLine, & .cm-inlineChangedLine": { backgroundColor: ADD_LINE },
	// The unified view's removed block is one widget of lines: one wash for the whole of it, aligned with
	// the code below rather than the library's 6px inset.
	"& .cm-deletedChunk": { backgroundColor: DEL_LINE, paddingLeft: "0" },
	// The ranges the library marks (the whole changed run) are what the line wash above already paints:
	// stacking a second coat there is how a diff ends up two shades of one colour on a single line.
	"&.cm-merge-a .cm-deletedLine, &.cm-merge-b .cm-insertedLine, & .cm-deletedChunk .cm-deletedLine": { backgroundColor: "transparent" },
	// The changed characters are the one place the library's own rule cannot be merely out-ordered: it paints
	// them with a 2px underline (`background: linear-gradient(...) bottom/100% 2px no-repeat`), and a longhand
	// `background-color` leaves that image, its size and its position standing — the green line under every
	// added block. So these reset the whole `background`, one class stronger than the library's `&light` /
	// `&dark` shapes (P-66, P-67).
	"&.cm-editor.cm-merge-a .cm-changedText": { background: DEL_TEXT },
	"&.cm-editor.cm-merge-b .cm-changedText": { background: ADD_TEXT },
	// The unified view's inline removal is a real `<del>`; the browser's strike-through is not the house's
	// way of saying "gone" — the wash and the bar already say it.
	"&.cm-editor.cm-merge-b .cm-deletedText, &.cm-editor.cm-merge-b .cm-deletedChunk .cm-deletedText, &.cm-editor.cm-merge-b .cm-deletedChunk del": {
		background: DEL_TEXT,
		textDecoration: "none",
	},
	// The bar is the change's strongest signal, and the only place either colour runs at full strength.
	".cm-changeGutter": { width: "3px", padding: "0" },
	"&.cm-merge-a .cm-changedLineGutter, & .cm-deletedLineGutter": { background: "var(--git-del)" },
	"&.cm-merge-b .cm-changedLineGutter, & .cm-inlineChangedLineGutter": { background: "var(--git-add)" },
	// "N unchanged lines": a quiet rule you can click open, not a card. The label sits in the code column
	// with the reader's chevron in front of it; the library's own ⦚ glyphs go.
	".cm-collapsedLines": {
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-start",
		gap: "6px",
		padding: "1px 8px 1px 3px",
		fontFamily: "var(--font-mono)",
		fontSize: "10px",
		color: "var(--color-muted)",
		background: "var(--color-paper-hover)",
		borderTop: "1px solid var(--color-hairline-soft)",
		borderBottom: "1px solid var(--color-hairline-soft)",
		"&:before": {
			content: '""',
			width: "11px",
			height: "11px",
			flex: "none",
			// The library puts its own 7px after the glyph it used to draw here; the flex gap is the air now.
			marginInlineEnd: "0",
			backgroundColor: "currentColor",
			WebkitMaskImage: EXPAND_ICON,
			WebkitMaskRepeat: "no-repeat",
			WebkitMaskPosition: "center",
			WebkitMaskSize: "contain",
			maskImage: EXPAND_ICON,
			maskRepeat: "no-repeat",
			maskPosition: "center",
			maskSize: "contain",
		},
		"&:after": { content: "none" },
	},
	"& .cm-collapsedLines:hover": { color: "var(--color-ink)", background: "var(--color-paper-deep)" },
});

/** One side of the comparison: a read-only editor wearing the diff's skin, coloured by shiki. */
function side(doc: string, wrapping: Extension, compartment: Compartment) {
	return {
		doc,
		extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), drawSelection(), lineNumbers(), tokenPainter(), compartment.of(wrapping), diffTheme],
	};
}

/**
 * Two panes, one document: the merge view scrolls them together vertically, but each pane carries its
 * own horizontal scroller (long lines), and two independent sideways scrollbars over one diff read as
 * two diffs. Mirroring the pair — guarded by the value, not a flag, so the echo stops itself — keeps the
 * columns aligned; a pane that cannot scroll that far simply clamps, and the other follows it there.
 */
function mirrorScroll(a: EditorView, b: EditorView): () => void {
	const mirror = (from: EditorView, to: EditorView) => () => {
		for (const axis of ["scrollLeft", "scrollTop"] as const) {
			if (from.scrollDOM[axis] !== to.scrollDOM[axis]) to.scrollDOM[axis] = from.scrollDOM[axis];
		}
	};
	const fromA = mirror(a, b);
	const fromB = mirror(b, a);
	a.scrollDOM.addEventListener("scroll", fromA);
	b.scrollDOM.addEventListener("scroll", fromB);
	return () => {
		a.scrollDOM.removeEventListener("scroll", fromA);
		b.scrollDOM.removeEventListener("scroll", fromB);
	};
}

/**
 * A change, read as two documents: side by side (the default) or as one unified column. Read-only, so no
 * accept/reject controls — this reader is for reading. A mode switch rebuilds the widget, which is cheap
 * for a diff and keeps each mode's setup honest.
 */
export function CodeDiff(props: { original: string; modified: string; lang: string | null; sideBySide: boolean; wrap: boolean }) {
	let hostEl: HTMLDivElement | undefined;
	const wrapCompartment = new Compartment();
	let mounted: EditorView[] = [];

	createEffect(() => {
		const host = hostEl;
		const original = props.original;
		const modified = props.modified;
		const lang = props.lang;
		const sideBySide = props.sideBySide;
		const wrapping = untrack(() => (props.wrap ? EditorView.lineWrapping : []));
		if (!host) return;
		host.replaceChildren();

		let alive = true;
		onCleanup(() => {
			alive = false;
		});
		// The text arrives readable and the colours follow: shiki tokenizes asynchronously, and a set that
		// lands after this widget is gone is dropped rather than dispatched into a dead view.
		const paint = (view: EditorView, doc: string) => {
			void highlightCodeToLines(doc, lang)
				.then((lines) => {
					if (alive) view.dispatch({ effects: setTokens.of({ content: doc, lines }) });
				})
				.catch(() => {});
		};

		if (sideBySide) {
			const merged = new MergeView({
				a: side(original, wrapping, wrapCompartment),
				b: side(modified, wrapping, wrapCompartment),
				parent: host,
				orientation: "a-b",
				highlightChanges: true,
				gutter: true,
				collapseUnchanged: { margin: 2 },
			});
			const unmirror = mirrorScroll(merged.a, merged.b);
			mounted = [merged.a, merged.b];
			paint(merged.a, original);
			paint(merged.b, modified);
			onCleanup(() => {
				unmirror();
				merged.destroy();
				mounted = [];
			});
			return;
		}

		const view = new EditorView({
			state: EditorState.create({
				doc: modified,
				extensions: [
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					wrapCompartment.of(wrapping),
					unifiedMergeView({
						original,
						highlightChanges: true,
						gutter: true,
						mergeControls: false,
						allowInlineDiffs: true,
						syntaxHighlightDeletions: false,
						collapseUnchanged: { margin: 2 },
					}),
					drawSelection(),
					lineNumbers(),
					tokenPainter(),
					diffTheme,
				],
			}),
			parent: host,
		});
		mounted = [view];
		paint(view, modified);
		onCleanup(() => {
			view.destroy();
			mounted = [];
		});
	});

	// Wrapping is the dock's reading preference, shared with the reader; toggling it reconfigures the panes
	// in place rather than rebuilding the diff, which would re-tokenize both sides and jump back to the top.
	createEffect(() => {
		const wrapping = props.wrap ? EditorView.lineWrapping : [];
		for (const view of mounted) view.dispatch({ effects: wrapCompartment.reconfigure(wrapping) });
	});

	return <div class="git-diff-host" ref={hostEl} />;
}
