import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { highlightCodeToLines } from "../lib/markdown";
import { setTokens, tokenPainter } from "../lib/shiki-tokens";

const SELECTION = "light-dark(#f2ded8, #3d2a23)";
const ADD_LINE = "color-mix(in srgb, var(--git-add) 10%, transparent)";
const DEL_LINE = "color-mix(in srgb, var(--git-del) 10%, transparent)";
const ADD_TEXT = "color-mix(in srgb, var(--git-add) 24%, transparent)";
const DEL_TEXT = "color-mix(in srgb, var(--git-del) 24%, transparent)";

const EXPAND_ICON =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E\")";

const diffTheme = EditorView.theme({
	"&": { height: "100%" },
	"&.cm-focused": { outline: "none" },
	".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "12px", lineHeight: "var(--explorer-line-height, 1.2)" },
	".cm-content": { padding: "0" },
	".cm-line": { padding: "0", minHeight: "var(--explorer-line-height-em, 1.2em)" },
	"&.cm-merge-a": { borderRight: "1px solid var(--color-hairline)" },
	"&.cm-focused .cm-selectionBackground, & .cm-selectionBackground": { backgroundColor: SELECTION },
	"&.cm-editor .cm-scroller .cm-content::selection, &.cm-editor .cm-scroller .cm-content ::selection, &.cm-editor.cm-focused .cm-scroller .cm-content ::selection": {
		background: "transparent !important",
		color: "inherit !important",
	},
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
	"&.cm-merge-a .cm-changedLine": { backgroundColor: DEL_LINE },
	"&.cm-merge-b .cm-changedLine, & .cm-inlineChangedLine": { backgroundColor: ADD_LINE },
	"& .cm-deletedChunk": { backgroundColor: DEL_LINE, paddingLeft: "0" },
	"&.cm-merge-a .cm-deletedLine, &.cm-merge-b .cm-insertedLine, & .cm-deletedChunk .cm-deletedLine": { backgroundColor: "transparent" },
	"&.cm-editor.cm-merge-a .cm-changedText": { background: DEL_TEXT },
	"&.cm-editor.cm-merge-b .cm-changedText": { background: ADD_TEXT },
	"&.cm-editor.cm-merge-b .cm-deletedText, &.cm-editor.cm-merge-b .cm-deletedChunk .cm-deletedText, &.cm-editor.cm-merge-b .cm-deletedChunk del": {
		background: DEL_TEXT,
		textDecoration: "none",
	},
	".cm-changeGutter": { width: "3px", padding: "0" },
	"&.cm-merge-a .cm-changedLineGutter, & .cm-deletedLineGutter": { background: "var(--git-del)" },
	"&.cm-merge-b .cm-changedLineGutter, & .cm-inlineChangedLineGutter": { background: "var(--git-add)" },
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

function side(doc: string, wrapping: Extension, compartment: Compartment) {
	return {
		doc,
		extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), drawSelection(), lineNumbers(), tokenPainter(), compartment.of(wrapping), diffTheme],
	};
}

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

export function CodeDiff(props: { original: string; modified: string; lang: string | null; sideBySide: boolean; wrap: boolean }) {
	const hostEl = useRef<HTMLDivElement>(null);
	const wrapCompartment = useRef(new Compartment());
	const mounted = useRef<EditorView[]>([]);
	const propsRef = useRef(props);
	propsRef.current = props;

	useEffect(() => {
		const host = hostEl.current;
		if (!host) return;
		host.replaceChildren();

		let alive = true;
		const wrapping = propsRef.current.wrap ? EditorView.lineWrapping : [];
		const paint = (view: EditorView, doc: string) => {
			void highlightCodeToLines(doc, props.lang)
				.then((lines) => {
					if (alive) view.dispatch({ effects: setTokens.of({ content: doc, lines }) });
				})
				.catch(() => {});
		};

		if (props.sideBySide) {
			const merged = new MergeView({
				a: side(props.original, wrapping, wrapCompartment.current),
				b: side(props.modified, wrapping, wrapCompartment.current),
				parent: host,
				orientation: "a-b",
				highlightChanges: true,
				gutter: true,
				collapseUnchanged: { margin: 2 },
			});
			const unmirror = mirrorScroll(merged.a, merged.b);
			mounted.current = [merged.a, merged.b];
			paint(merged.a, props.original);
			paint(merged.b, props.modified);
			return () => {
				alive = false;
				unmirror();
				merged.destroy();
				mounted.current = [];
			};
		}

		const view = new EditorView({
			state: EditorState.create({
				doc: props.modified,
				extensions: [
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					wrapCompartment.current.of(wrapping),
					unifiedMergeView({
						original: props.original,
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
		mounted.current = [view];
		paint(view, props.modified);
		return () => {
			alive = false;
			view.destroy();
			mounted.current = [];
		};
	}, [props.original, props.modified, props.lang, props.sideBySide]);

	useEffect(() => {
		const wrapping = props.wrap ? EditorView.lineWrapping : [];
		for (const view of mounted.current) view.dispatch({ effects: wrapCompartment.current.reconfigure(wrapping) });
	}, [props.wrap]);

	return <div className="git-diff-host" ref={hostEl} />;
}
