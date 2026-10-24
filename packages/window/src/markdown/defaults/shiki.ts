import { fromHighlighter, type MarkdownItShikiSetupOptions } from "@shikijs/markdown-it/core";
import type { LanguageInput } from "shiki";

import { getHighlighter, HIGHLIGHT_LIMITS, SHIKI_THEMES } from "../highlighter.ts";
import type { MarkdownPlugin } from "../types.ts";

type Options = MarkdownItShikiSetupOptions & { readonly tokenizeMaxLineLength?: number; readonly tokenizeTimeLimit?: number };

const TEXT = "text" as unknown as LanguageInput;

const OPTIONS: Options = {
	themes: SHIKI_THEMES,
	defaultColor: "light-dark()",
	defaultLanguage: TEXT,
	fallbackLanguage: TEXT,
	...HIGHLIGHT_LIMITS,
};

export const shikiPlugin: MarkdownPlugin = {
	id: "shiki",
	order: 40,
	tier: "full",
	async setup(md) {
		const highlighter = await getHighlighter();
		md.use(fromHighlighter(highlighter, OPTIONS));
	},
};
