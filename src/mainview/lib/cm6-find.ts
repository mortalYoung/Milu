import { foldedRanges } from "@codemirror/language";
import { getSearchQuery } from "@codemirror/search";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export interface Span {
	from: number;
	to: number;
}

export type HiddenSpans = (state: EditorState) => readonly Span[];

export const noHidden: HiddenSpans = () => [];

export function foldedSpans(state: EditorState): Span[] {
	const spans: Span[] = [];
	foldedRanges(state).between(0, state.doc.length, (from, to) => {
		spans.push({ from, to });
	});
	return spans;
}

export function matchSpans(state: EditorState, hidden: HiddenSpans = noHidden): Span[] {
	const query = getSearchQuery(state);
	if (!query.valid) return [];
	const holes = hidden(state);
	const spans: Span[] = [];
	const cursor = query.getCursor(state);
	for (let next = cursor.next(); !next.done; next = cursor.next()) {
		const { from, to } = next.value;
		if (holes.some((hole) => from < hole.to && to > hole.from)) continue;
		spans.push({ from, to });
	}
	return spans;
}

export function currentSpan(state: EditorState, spans: readonly Span[]): number {
	const caret = state.selection.main.from;
	const index = spans.findIndex((span) => span.from <= caret && span.to >= caret);
	return index < 0 ? 0 : index;
}

const plainMatch = Decoration.mark({ class: "cm-searchMatch" });
const currentMatch = Decoration.mark({ class: "cm-searchMatch cm-searchMatch-selected" });

class MatchHighlighter {
	decorations: DecorationSet;
	private hidden: HiddenSpans;

	constructor(view: EditorView, hidden: HiddenSpans) {
		this.hidden = hidden;
		this.decorations = this.build(view.state);
	}

	update(update: ViewUpdate) {
		this.decorations = this.build(update.state);
	}

	private build(state: EditorState): DecorationSet {
		const spans = matchSpans(state, this.hidden);
		const current = currentSpan(state, spans);
		const builder = new RangeSetBuilder<Decoration>();
		spans.forEach((span, index) => builder.add(span.from, span.to, index === current ? currentMatch : plainMatch));
		return builder.finish();
	}
}

export function searchMatchHighlighter(hidden: HiddenSpans = noHidden) {
	return ViewPlugin.define((view) => new MatchHighlighter(view, hidden), { decorations: (plugin) => plugin.decorations });
}
