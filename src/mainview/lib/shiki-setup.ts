/**
 * The one place shiki is configured: grammars, themes and the tokenize limits. Both the main thread
 * (markdown fences, and the fallback when no worker can run) and the tokenize worker build their
 * highlighter from here, so a colour can never differ by which side painted it (P-64).
 *
 * Every shiki module is a dynamic `import()` so the bundler splits them into a lazy chunk — the main
 * bundle only pays for markdown-it + app code, and the worker chunk only pays for shiki.
 */

import type { HighlighterCore } from "@shikijs/types";

export interface HighlightToken {
	content: string;
	htmlStyle?: Record<string, string>;
}

export interface HighlightLine {
	tokens: HighlightToken[];
}

/** shiki's own per-line guards: a longer line is emitted as one plain token, and tokenizing one line
 *  gives up past the time limit. Wired to the `highlight` settings group. */
export interface HighlightLimits {
	tokenizeMaxLineLength: number;
	tokenizeTimeLimit: number;
}

export const DEFAULT_HIGHLIGHT_LIMITS: HighlightLimits = { tokenizeMaxLineLength: 3000, tokenizeTimeLimit: 500 };

/** Dual themes: `defaultColor: "light-dark()"` emits every token colour as an inline light/dark pair,
 *  resolved by the app's `color-scheme` — code follows the theme with no re-render. */
export const SHIKI_OPTIONS = {
	themes: { light: "github-light", dark: "github-dark" },
	defaultColor: "light-dark()",
} as const;

let limits: HighlightLimits = { ...DEFAULT_HIGHLIGHT_LIMITS };
let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlightLimits(): HighlightLimits {
	return limits;
}

/** Returns true when the limits actually changed. */
export function setHighlightLimits(next?: Partial<HighlightLimits> | null): boolean {
	const merged = { ...DEFAULT_HIGHLIGHT_LIMITS, ...next };
	if (merged.tokenizeMaxLineLength === limits.tokenizeMaxLineLength && merged.tokenizeTimeLimit === limits.tokenizeTimeLimit) return false;
	limits = merged;
	return true;
}

async function buildHighlighter(): Promise<HighlighterCore> {
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

/** The main thread's highlighter: markdown fences, and the fallback when a worker cannot run. */
export function getHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= buildHighlighter();
	return highlighterPromise;
}

export async function createHighlighter(): Promise<HighlighterCore> {
	return buildHighlighter();
}

/** Tokenize `code` and keep only what a painter needs: content + inline style per token. */
export async function tokenizeLines(highlighter: HighlighterCore, code: string, lang?: string | null, limits?: HighlightLimits): Promise<HighlightLine[]> {
	const result = highlighter.codeToTokens(code, {
		...SHIKI_OPTIONS,
		lang: lang ?? "text",
		...(limits ?? getHighlightLimits()),
	});
	return result.tokens.map((line) => ({
		tokens: line.map((token) => ({ content: token.content, htmlStyle: token.htmlStyle })),
	}));
}
