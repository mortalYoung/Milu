import { type EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { HighlightLine } from "./markdown";

/**
 * shiki → CodeMirror, for every code surface in the app: the colours arrive as decorations, so a late
 * or repeated token set never costs the selection, and both the reader and the diff paint with one
 * highlighter (P-64: one source per job).
 */

/** A whole document's tokens, or null to leave the text plain. */
export const setTokens = StateEffect.define<{ content: string; lines: HighlightLine[] } | null>();

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

/**
 * The colours ride *under* the surface's own decorations: a search match, a diff's changed characters —
 * whatever the reading surface paints has to land on top of a token, never below it.
 */
export function tokenPainter() {
	return Prec.lowest(tokenField);
}
