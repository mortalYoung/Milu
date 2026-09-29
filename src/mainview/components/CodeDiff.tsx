import { Change, type Chunk, type DiffConfig, diff, getChunks, MergeView, mergeViewSiblings, unifiedMergeView } from "@codemirror/merge";
import { search } from "@codemirror/search";
import { Compartment, EditorState, type Extension, type Range, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, GutterMarker, gutter, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type HiddenSpans, searchMatchHighlighter } from "../lib/cm6-find";
import { cm6FindEngine, useFindBar, useFindHandler } from "../lib/find";
import { highlightCodeToLines } from "../lib/shiki-remote";
import { setTokens, tokenPainter } from "../lib/shiki-tokens";
import { SURFACE } from "../lib/surfaces";
import { FloatFind } from "./FloatFind";

const SELECTION = "light-dark(#f2ded8, #3d2a23)";
const ADD_LINE = "color-mix(in srgb, var(--git-add) 10%, transparent)";
const DEL_LINE = "color-mix(in srgb, var(--git-del) 10%, transparent)";
const ADD_TEXT = "color-mix(in srgb, var(--git-add) 24%, transparent)";
const DEL_TEXT = "color-mix(in srgb, var(--git-del) 24%, transparent)";
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

const TEXT_PAD = "calc((var(--explorer-line-height, 1.2) - 1.37) * 0.5em)";

function hiddenGaps(state: EditorState): { from: number; to: number }[] {
	const plan = state.field(foldPlanField, false) ?? [];
	const closed = foldedNow(state, plan.length);
	return plan.filter((_, index) => closed.has(index)).map((gap) => ({ from: gap.from, to: gap.to }));
}

const diffHidden: HiddenSpans = hiddenGaps;

const diffTheme = EditorView.theme({
	"&": { height: "100%" },
	".cm-searchMatch": { background: "color-mix(in srgb, var(--color-seal) 26%, transparent)", borderRadius: "2px" },
	".cm-searchMatch-selected": { background: "color-mix(in srgb, var(--color-seal) 60%, transparent)" },
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
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: "4px",
		padding: "0 7px 0 5px",
		minWidth: "20px",
		whiteSpace: "nowrap",
		userSelect: "none",
		fontVariantNumeric: "tabular-nums",
	},
	".cm-foldCell": { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" },
	".cm-foldCell > span:first-child": { lineHeight: "1" },
	".cm-foldSlot": { width: "14px", height: "14px", flex: "none", display: "flex", alignItems: "center", justifyContent: "center" },
	".cm-foldToggle": {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: "14px",
		height: "14px",
		flex: "none",
		padding: "0",
		border: "0",
		borderRadius: "3px",
		background: "transparent",
		color: "var(--color-muted)",
		cursor: "pointer",
	},
	".cm-foldToggle svg": { width: "12px", height: "12px" },
	".cm-foldToggle:hover": { color: "var(--color-ink)", background: "var(--color-paper-hover)" },
	".cm-foldToggle:focus-visible": { outline: "1px solid var(--color-seal)", outlineOffset: "-1px" },
	"&.cm-merge-a .cm-changedLine": { backgroundColor: DEL_LINE },
	"&.cm-merge-b .cm-changedLine, & .cm-inlineChangedLine": { backgroundColor: ADD_LINE },
	"& .cm-deletedChunk": { backgroundColor: DEL_LINE, paddingLeft: "0" },
	"&.cm-merge-a .cm-deletedLine, &.cm-merge-b .cm-insertedLine, & .cm-deletedChunk .cm-deletedLine": { backgroundColor: "transparent" },
	"&.cm-editor.cm-merge-a .cm-changedText": { background: DEL_TEXT, paddingBlock: TEXT_PAD },
	"&.cm-editor.cm-merge-b .cm-changedText": { background: ADD_TEXT, paddingBlock: TEXT_PAD },
	".cm-unfoldedLine": { backgroundColor: "var(--color-paper-hover)" },
	".cm-mergeSpacer": {
		background: "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--color-muted) 22%, transparent) 5px 6px)",
	},
	".cm-collapsedLines": {
		display: "flex",
		alignItems: "center",
		padding: "1px 8px",
		fontFamily: "var(--font-mono)",
		fontSize: "10px",
		color: "var(--color-muted)",
		background: "var(--color-paper-hover)",
		borderTop: "1px solid var(--color-hairline-soft)",
		borderBottom: "1px solid var(--color-hairline-soft)",
		cursor: "pointer",
	},
	".cm-collapsedLines:hover": { color: "var(--color-ink)", background: "var(--color-paper-deep)" },
});

// ——— unchanged runs: folded into a band, or spread out and lit ———

const FOLD_MARGIN = 3;
const FOLD_MIN_LINES = 4;

interface FoldGap {
	from: number;
	to: number;
	number: number;
	lines: number;
}

interface FoldPlan {
	a: FoldGap[];
	b: FoldGap[];
}

interface SideSpan {
	start: number;
	next: number;
}

const WHITESPACE_SCAN_LIMIT = 500;

function trimLines(text: string): { text: string; lead: number[] } {
	const lead: number[] = [];
	const lines = text.split("\n").map((line) => {
		const start = line.length - line.trimStart().length;
		lead.push(start);
		return line.slice(start).trimEnd();
	});
	return { text: lines.join("\n"), lead };
}

function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
	return starts;
}

function mapOffset(pos: number, starts: readonly number[], lead: readonly number[]): number {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if ((starts[mid] ?? 0) <= pos) low = mid;
		else high = mid - 1;
	}
	const start = starts[low] ?? 0;
	return start + (lead[low] ?? 0) + (pos - start);
}

const trimWhitespaceDiff: NonNullable<DiffConfig["override"]> = (a, b) => {
	const left = trimLines(a);
	const right = trimLines(b);
	const startsA = lineStarts(left.text);
	const startsB = lineStarts(right.text);
	return diff(left.text, right.text, { scanLimit: WHITESPACE_SCAN_LIMIT }).map(
		(change) =>
			new Change(
				mapOffset(change.fromA, startsA, left.lead),
				mapOffset(change.toA, startsA, left.lead),
				mapOffset(change.fromB, startsB, right.lead),
				mapOffset(change.toB, startsB, right.lead),
			),
	);
};

function chunkSpan(doc: Text, from: number, end: number): SideSpan {
	const clamp = (pos: number) => Math.min(Math.max(pos, 0), doc.length);
	const line = doc.lineAt(clamp(from));
	if (from === end) {
		const onBoundary = clamp(from) === line.from;
		return { start: line.number, next: onBoundary ? line.number : line.number + 1 };
	}
	return { start: line.number, next: doc.lineAt(clamp(end - 1)).number + 1 };
}

function gapOf(doc: Text, first: number, last: number): FoldGap {
	return { from: doc.line(first).from, to: doc.line(last).to, number: first, lines: last - first + 1 };
}

function buildFoldPlan(a: Text, b: Text, chunks: readonly Chunk[]): FoldPlan {
	const plan: FoldPlan = { a: [], b: [] };
	const runs: { aFirst: number; aLast: number; bFirst: number; bLast: number }[] = [];
	let aCursor = 1;
	let bCursor = 1;
	for (const chunk of chunks) {
		const aSpan = chunkSpan(a, chunk.fromA, chunk.endA);
		const bSpan = chunkSpan(b, chunk.fromB, chunk.endB);
		runs.push({ aFirst: aCursor, aLast: aSpan.start - 1, bFirst: bCursor, bLast: bSpan.start - 1 });
		aCursor = aSpan.next;
		bCursor = bSpan.next;
	}
	runs.push({ aFirst: aCursor, aLast: a.lines, bFirst: bCursor, bLast: b.lines });
	for (const run of runs) {
		const aStart = run.aFirst > 1 ? run.aFirst + FOLD_MARGIN : run.aFirst;
		const aEnd = run.aLast < a.lines ? run.aLast - FOLD_MARGIN : run.aLast;
		const bStart = run.bFirst > 1 ? run.bFirst + FOLD_MARGIN : run.bFirst;
		const bEnd = run.bLast < b.lines ? run.bLast - FOLD_MARGIN : run.bLast;
		if (aEnd - aStart + 1 < FOLD_MIN_LINES || bEnd - bStart + 1 < FOLD_MIN_LINES) continue;
		plan.a.push(gapOf(a, aStart, aEnd));
		plan.b.push(gapOf(b, bStart, bEnd));
	}
	return plan;
}

const setFoldPlan = StateEffect.define<readonly FoldGap[]>();

const foldPlanField = StateField.define<readonly FoldGap[]>({
	create: () => [],
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(setFoldPlan)) return effect.value;
		return value;
	},
});

const setFolded = StateEffect.define<readonly number[] | null>();

const foldedField = StateField.define<readonly number[] | null>({
	create: () => null,
	update(value, transaction) {
		for (const effect of transaction.effects) if (effect.is(setFolded)) return effect.value;
		return value;
	},
});

function foldedNow(state: EditorState, count: number): Set<number> {
	const stored = state.field(foldedField, false) ?? null;
	if (stored === null) return new Set(Array.from({ length: count }, (_, index) => index));
	return new Set(stored);
}

function gapIndexAt(gaps: readonly FoldGap[], pos: number): number {
	let low = 0;
	let high = gaps.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const gap = gaps[mid]!;
		if (pos < gap.from) high = mid - 1;
		else if (pos > gap.to) low = mid + 1;
		else return mid;
	}
	return -1;
}

function chunksArrived(update: ViewUpdate): boolean {
	return getChunks(update.startState) === null && getChunks(update.state) !== null;
}

function foldRanges(state: EditorState): DecorationSet {
	const gaps = state.field(foldPlanField, false) ?? [];
	if (gaps.length === 0) return Decoration.none;
	const folded = foldedNow(state, gaps.length);
	const ranges: Range<Decoration>[] = [];
	gaps.forEach((gap, index) => {
		if (!folded.has(index)) {
			for (let pos = gap.from; ; ) {
				const line = state.doc.lineAt(pos);
				ranges.push(Decoration.line({ class: "cm-unfoldedLine" }).range(line.from));
				if (line.to >= gap.to) break;
				pos = line.to + 1;
			}
			return;
		}
		ranges.push(Decoration.replace({ block: true, widget: new FoldBand(gap, index) }).range(gap.from, gap.to));
	});
	return Decoration.set(ranges, true);
}

const foldDecorations = StateField.define<DecorationSet>({
	create: (state) => foldRanges(state),
	update(decorations, transaction) {
		const planChanged = transaction.startState.field(foldPlanField, false) !== transaction.state.field(foldPlanField, false);
		const foldsChanged = transaction.startState.field(foldedField, false) !== transaction.state.field(foldedField, false);
		if (planChanged || foldsChanged) return foldRanges(transaction.state);
		return transaction.docChanged ? decorations.map(transaction.changes) : decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});

function toggleFold(view: EditorView, index: number) {
	const count = (view.state.field(foldPlanField, false) ?? []).length;
	const folded = new Set(view.state.field(foldedField, false) ?? Array.from({ length: count }, (_, i) => i));
	if (folded.has(index)) folded.delete(index);
	else folded.add(index);
	const next = [...folded].sort((a, b) => a - b);
	const siblings = mergeViewSiblings(view);
	const targets = siblings ? [siblings.a, siblings.b] : [view];
	for (const target of targets) if (target) target.dispatch({ effects: setFolded.of(next) });
}

class FoldBand extends WidgetType {
	constructor(
		readonly gap: FoldGap,
		readonly index: number,
	) {
		super();
	}
	eq(other: FoldBand) {
		return other.gap.lines === this.gap.lines && other.gap.number === this.gap.number;
	}
	toDOM(view: EditorView) {
		const band = document.createElement("div");
		band.className = "cm-collapsedLines";
		band.textContent = `${this.gap.lines} unchanged lines`;
		band.addEventListener("mousedown", (event) => {
			event.preventDefault();
			toggleFold(view, this.index);
		});
		return band;
	}
	ignoreEvent(event: Event) {
		return event instanceof MouseEvent;
	}
}

class FoldNumberMarker extends GutterMarker {
	constructor(
		readonly number: number,
		readonly fold: "open" | "closed" | null,
		readonly index: number | null,
	) {
		super();
	}
	eq(other: FoldNumberMarker) {
		return other.number === this.number && other.fold === this.fold;
	}
	toDOM(view: EditorView) {
		const cell = document.createElement("span");
		cell.className = "cm-foldCell";
		const label = document.createElement("span");
		label.textContent = String(this.number);
		cell.appendChild(label);
		const slot = document.createElement("span");
		slot.className = "cm-foldSlot";
		if (this.fold) {
			const index = this.index;
			const button = document.createElement("button");
			button.type = "button";
			button.tabIndex = -1;
			button.className = "cm-foldToggle";
			button.setAttribute("aria-label", this.fold === "closed" ? "Show unchanged lines" : "Hide unchanged lines");
			button.innerHTML = this.fold === "closed" ? CHEVRON_RIGHT : CHEVRON_DOWN;
			button.addEventListener("mousedown", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (index != null) toggleFold(view, index);
			});
			slot.appendChild(button);
		}
		cell.appendChild(slot);
		return cell;
	}
}

function numberedFoldGutter() {
	return gutter({
		class: "cm-lineNumbers",
		lineMarker(view, line) {
			const gaps = view.state.field(foldPlanField, false) ?? [];
			const index = gapIndexAt(gaps, line.from);
			const starts = index >= 0 && gaps[index]!.from === line.from;
			return new FoldNumberMarker(view.state.doc.lineAt(line.from).number, starts ? "open" : null, starts ? index : null);
		},
		widgetMarker(view, widget) {
			if (!(widget instanceof FoldBand)) return null;
			const gaps = view.state.field(foldPlanField, false) ?? [];
			const index = gapIndexAt(gaps, widget.gap.from);
			return new FoldNumberMarker(widget.gap.number, "closed", index < 0 ? null : index);
		},
		lineMarkerChange: (update) =>
			update.docChanged ||
			update.startState.field(foldPlanField, false) !== update.state.field(foldPlanField, false) ||
			update.startState.field(foldedField, false) !== update.state.field(foldedField, false),
		initialSpacer: (view) => new FoldNumberMarker(view.state.doc.lines, null, null),
	});
}

// ——— character-level marks: only where the change is shorter than its line ———

const WHOLE_LINE_RESIDUE = 0.25;

function mergeSpans(spans: { from: number; to: number }[]): { from: number; to: number }[] {
	const sorted = [...spans].sort((a, b) => a.from - b.from);
	const out: { from: number; to: number }[] = [];
	for (const span of sorted) {
		const last = out[out.length - 1];
		if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
		else out.push({ ...span });
	}
	return out;
}

interface LineTells {
	spans: Map<number, { from: number; to: number }[]>;
	whole: Set<number>;
}

function lineTells(state: EditorState, side: "a" | "b"): LineTells {
	const spans = new Map<number, { from: number; to: number }[]>();
	const whole = new Set<number>();
	const info = getChunks(state);
	if (!info) return { spans, whole };
	for (const chunk of info.chunks) {
		const base = side === "a" ? chunk.fromA : chunk.fromB;
		for (const change of chunk.changes) {
			const from = base + (side === "a" ? change.fromA : change.fromB);
			const to = base + (side === "a" ? change.toA : change.toB);
			if (from >= to) continue;
			const first = state.doc.lineAt(from).number;
			const last = state.doc.lineAt(Math.min(to - 1, state.doc.length)).number;
			for (let number = first; number <= last; number += 1) {
				const line = state.doc.line(number);
				const onLine = spans.get(number) ?? [];
				onLine.push({ from: Math.max(from, line.from), to: Math.min(to, line.to) });
				spans.set(number, onLine);
			}
		}
	}
	for (const [number, onLine] of spans) {
		const line = state.doc.line(number);
		const trimmedFrom = line.from + (line.text.length - line.text.trimStart().length);
		const trimmedTo = line.to - (line.text.length - line.text.trimEnd().length);
		const trimmed = Math.max(0, trimmedTo - trimmedFrom);
		const covered = mergeSpans(onLine.filter((span) => span.from < span.to));
		if (covered.some((span) => span.from <= trimmedFrom && span.to >= trimmedTo)) {
			whole.add(number);
			continue;
		}
		const told = covered.reduce((sum, span) => sum + Math.max(0, Math.min(span.to, trimmedTo) - Math.max(span.from, trimmedFrom)), 0);
		if (trimmed > 0 && (trimmed - told) / trimmed <= WHOLE_LINE_RESIDUE) whole.add(number);
	}
	return { spans, whole };
}

function charMarks(side: "a" | "b") {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;

			constructor(view: EditorView) {
				this.build(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || chunksArrived(update) || !getChunks(update.state)) this.build(update.view);
			}

			private build(view: EditorView) {
				const { spans, whole } = lineTells(view.state, side);
				const ranges: Range<Decoration>[] = [];
				for (const [number, onLine] of spans) {
					if (whole.has(number)) continue;
					for (const span of onLine) if (span.from < span.to) ranges.push(Decoration.mark({ class: "cm-changedText" }).range(span.from, span.to));
				}
				this.decorations = Decoration.set(ranges, true);
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}

// ——— the sides ———

function side(doc: string, wrapping: Extension, compartment: Compartment, extra: Extension[]) {
	return {
		doc,
		extensions: [
			EditorState.readOnly.of(true),
			EditorView.editable.of(false),
			drawSelection(),
			tokenPainter(),
			foldPlanField,
			foldedField,
			foldDecorations,
			numberedFoldGutter(),
			compartment.of(wrapping),
			...extra,
			search(),
			searchMatchHighlighter(diffHidden),
			diffTheme,
		],
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

export function CodeDiff(props: { original: string; modified: string; lang: string | null; sideBySide: boolean; wrap: boolean; ignoreWhitespace: boolean }) {
	const hostEl = useRef<HTMLDivElement>(null);
	const wrapCompartment = useRef(new Compartment());
	const mounted = useRef<EditorView[]>([]);
	const [viewEpoch, setViewEpoch] = useState(0);
	const savedScroll = useRef<{ top: number; left: number }[] | null>(null);
	const propsRef = useRef(props);
	propsRef.current = props;

	const findEngine = useCallback(() => cm6FindEngine(mounted.current.at(-1) ?? null, diffHidden), [viewEpoch]);
	const find = useFindBar({ engine: findEngine, canClaim: () => mounted.current.length > 0 });
	useFindHandler(SURFACE.diff, () => find.claim());

	useEffect(() => {
		if (find.open) {
			find.refresh();
			return;
		}
		for (const view of mounted.current) view.dispatch({ selection: { anchor: view.state.selection.main.head } });
	}, [find.open, find.refresh, viewEpoch]);

	useEffect(() => {
		const host = hostEl.current;
		if (!host) return;
		const restore = savedScroll.current;
		savedScroll.current = null;
		host.replaceChildren();

		let alive = true;
		const restoreScroll = () => {
			mounted.current.forEach((view, index) => {
				const saved = restore?.[index];
				if (!saved) return;
				view.scrollDOM.scrollTop = saved.top;
				view.scrollDOM.scrollLeft = saved.left;
			});
		};
		const keepScroll = () => {
			const next = propsRef.current;
			savedScroll.current =
				next.original === props.original && next.modified === props.modified
					? mounted.current.map((view) => ({ top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft }))
					: null;
		};
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
				a: side(props.original, wrapping, wrapCompartment.current, [charMarks("a")]),
				b: side(props.modified, wrapping, wrapCompartment.current, [charMarks("b")]),
				parent: host,
				orientation: "a-b",
				highlightChanges: false,
				gutter: false,
				...(props.ignoreWhitespace ? { diffConfig: { override: trimWhitespaceDiff } } : {}),
			});
			const handOver = () => {
				const chunks = getChunks(merged.b.state)?.chunks ?? getChunks(merged.a.state)?.chunks;
				if (!chunks) return false;
				const plan = buildFoldPlan(merged.a.state.doc, merged.b.state.doc, chunks);
				merged.a.dispatch({ effects: setFoldPlan.of(plan.a) });
				merged.b.dispatch({ effects: setFoldPlan.of(plan.b) });
				merged.a.requestMeasure();
				merged.b.requestMeasure();
				return true;
			};
			if (!handOver()) {
				let tries = 0;
				const retry = () => {
					if (alive && !handOver() && (tries += 1) < 4) requestAnimationFrame(retry);
				};
				requestAnimationFrame(retry);
			}
			const unmirror = mirrorScroll(merged.a, merged.b);
			mounted.current = [merged.a, merged.b];
			setViewEpoch((n) => n + 1);
			restoreScroll();
			paint(merged.a, props.original);
			paint(merged.b, props.modified);
			return () => {
				alive = false;
				keepScroll();
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
						highlightChanges: false,
						gutter: false,
						mergeControls: false,
						allowInlineDiffs: false,
						syntaxHighlightDeletions: false,
						...(props.ignoreWhitespace ? { diffConfig: { override: trimWhitespaceDiff } } : {}),
					}),
					drawSelection(),
					tokenPainter(),
					foldPlanField,
					foldedField,
					foldDecorations,
					numberedFoldGutter(),
					charMarks("b"),
					search(),
					searchMatchHighlighter(diffHidden),
					diffTheme,
				],
			}),
			parent: host,
		});
		const handOver = () => {
			const chunks = getChunks(view.state)?.chunks;
			if (!chunks) return false;
			view.dispatch({ effects: setFoldPlan.of(buildFoldPlan(Text.of(props.original.split("\n")), view.state.doc, chunks).b) });
			view.requestMeasure();
			return true;
		};
		if (!handOver()) {
			let tries = 0;
			const retry = () => {
				if (alive && !handOver() && (tries += 1) < 4) requestAnimationFrame(retry);
			};
			requestAnimationFrame(retry);
		}
		mounted.current = [view];
		setViewEpoch((n) => n + 1);
		restoreScroll();
		paint(view, props.modified);
		return () => {
			alive = false;
			keepScroll();
			view.destroy();
			mounted.current = [];
		};
	}, [props.original, props.modified, props.lang, props.sideBySide, props.ignoreWhitespace]);

	useEffect(() => {
		const wrapping = props.wrap ? EditorView.lineWrapping : [];
		for (const view of mounted.current) view.dispatch({ effects: wrapCompartment.current.reconfigure(wrapping) });
	}, [props.wrap]);

	return (
		<div className="git-diff-area">
			<div className="git-diff-host" ref={hostEl} />
			<AnimatePresence>{find.open ? <FloatFind {...find.props} /> : null}</AnimatePresence>
		</div>
	);
}
