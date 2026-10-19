import type { HighlighterCore } from "shiki/core";

export const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const;

export const HIGHLIGHT_LIMITS = { tokenizeMaxLineLength: 3000, tokenizeTimeLimit: 500 } as const;

let highlighter: Promise<HighlighterCore> | null = null;

async function build(): Promise<HighlighterCore> {
	const [
		{ createHighlighterCore },
		{ createJavaScriptRegexEngine },
		ts,
		tsx,
		js,
		jsx,
		python,
		html,
		css,
		json,
		jsonc,
		markdown,
		yaml,
		bash,
		sql,
		toml,
		ini,
		diff,
		xml,
		githubLight,
		githubDark,
	] = await Promise.all([
		import("shiki/core"),
		import("shiki/engine/javascript"),
		import("shiki/langs/ts.mjs"),
		import("shiki/langs/tsx.mjs"),
		import("shiki/langs/js.mjs"),
		import("shiki/langs/jsx.mjs"),
		import("shiki/langs/python.mjs"),
		import("shiki/langs/html.mjs"),
		import("shiki/langs/css.mjs"),
		import("shiki/langs/json.mjs"),
		import("shiki/langs/jsonc.mjs"),
		import("shiki/langs/markdown.mjs"),
		import("shiki/langs/yaml.mjs"),
		import("shiki/langs/bash.mjs"),
		import("shiki/langs/sql.mjs"),
		import("shiki/langs/toml.mjs"),
		import("shiki/langs/ini.mjs"),
		import("shiki/langs/diff.mjs"),
		import("shiki/langs/xml.mjs"),
		import("shiki/themes/github-light.mjs"),
		import("shiki/themes/github-dark.mjs"),
	]);

	return createHighlighterCore({
		themes: [githubLight.default, githubDark.default],
		langs: [
			ts.default,
			tsx.default,
			js.default,
			jsx.default,
			python.default,
			html.default,
			css.default,
			json.default,
			jsonc.default,
			markdown.default,
			yaml.default,
			bash.default,
			sql.default,
			toml.default,
			ini.default,
			diff.default,
			xml.default,
		],
		engine: createJavaScriptRegexEngine(),
	});
}

export function getHighlighter(): Promise<HighlighterCore> {
	highlighter ??= build();
	return highlighter;
}
