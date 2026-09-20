import type { Extension } from "@codemirror/state";

/**
 * Folding is structural, so it comes from the parser — lezer — while the colours stay with shiki
 * (P-64: one source per job). The whole language is pulled in on demand, and only when folding is
 * switched on for the file; nothing here ever highlights anything, so no `syntaxHighlighting` and no
 * keymaps come along with it.
 *
 * The ids are shiki's, from `languageForPath`: the same name picks both the colour grammar and the
 * parser. Languages without a parser (bash, sql, toml, ini, diff) simply do not fold.
 */
const loaders: Record<string, () => Promise<Extension>> = {
	ts: async () => (await import("@codemirror/lang-javascript")).javascriptLanguage.configure({ dialect: "ts" }),
	tsx: async () => (await import("@codemirror/lang-javascript")).tsxLanguage,
	js: async () => (await import("@codemirror/lang-javascript")).javascriptLanguage,
	jsx: async () => (await import("@codemirror/lang-javascript")).jsxLanguage,
	python: async () => (await import("@codemirror/lang-python")).pythonLanguage,
	html: async () => (await import("@codemirror/lang-html")).htmlLanguage,
	css: async () => (await import("@codemirror/lang-css")).cssLanguage,
	json: async () => (await import("@codemirror/lang-json")).jsonLanguage,
	markdown: async () => (await import("@codemirror/lang-markdown")).markdownLanguage,
	yaml: async () => (await import("@codemirror/lang-yaml")).yamlLanguage,
	xml: async () => (await import("@codemirror/lang-xml")).xmlLanguage,
};

const loaded = new Map<string, Extension>();

/** The parser that knows how to fold this language, or null when there is none. */
export async function foldLanguage(lang: string | null): Promise<Extension | null> {
	if (!lang) return null;
	const cached = loaded.get(lang);
	if (cached) return cached;
	const load = loaders[lang];
	if (!load) return null;
	const language = await load();
	loaded.set(lang, language);
	return language;
}
