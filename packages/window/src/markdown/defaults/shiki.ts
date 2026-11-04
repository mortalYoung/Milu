import { getHighlighter, highlightWith } from "../highlighter.ts";
import type { MarkdownPlugin } from "../types.ts";

export const shikiPlugin: MarkdownPlugin = {
	id: "shiki",
	order: 40,
	tier: "full",
	async setup(md) {
		const highlighter = await getHighlighter();
		md.options.highlight = (code, lang) => highlightWith(highlighter, code, lang);
	},
};
