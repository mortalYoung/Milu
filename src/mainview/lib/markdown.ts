/**
 * Markdown → HTML renderer: markdown-it (full CommonMark) + shiki (TextMate highlighting).
 *
 * The highlighter is a cached singleton built once at module load (async warm-up, ~100ms), then
 * `codeToHtml` is synchronous and every render reuses the same instance. Bundle is fine-grained:
 * only tsx/ts/js/python/html/css grammars are imported (via shiki/core + per-language entries) plus
 * a single light theme and the JavaScript regex engine — no WASM, no full grammar dump.
 * While the highlighter is still warming up, a plain markdown-it instance renders without
 * highlighting — the layout never blocks on async work.
 *
 * HTML is escaped by markdown-it (`html: false`), so user content is never executed as tags.
 */

import { fromHighlighter } from "@shikijs/markdown-it";
import type { HighlighterCore } from "@shikijs/types";
import MarkdownIt, { type MarkdownIt as MarkdownItType, type Renderer, type RendererRule } from "markdown-it";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import css from "shiki/langs/css.mjs";
import html from "shiki/langs/html.mjs";
import js from "shiki/langs/js.mjs";
import python from "shiki/langs/python.mjs";
import ts from "shiki/langs/ts.mjs";
import tsx from "shiki/langs/tsx.mjs";
import githubLight from "shiki/themes/github-light.mjs";

/** The only languages we bundle — keep the grammar payload small. */
const HIGHLIGHT_LANGS = [ts, tsx, js, python, html, css];
/** The single light theme (shiki inline-styles token colors; matches the light letter paper). */
const HIGHLIGHT_THEME = "github-light";
// shiki treats "text" as the built-in plain-text language at runtime, but it is not a member of the
// BundledLanguage union — cast it through unknown once.
const TEXT_LANG = "text" as unknown as Parameters<typeof fromHighlighter>[1]["defaultLanguage"];

/** Plain markdown-it (no highlighting) — the fallback while the highlighter warms up. */
const mdPlain = new MarkdownIt({ html: false, linkify: true });
patchLinkTarget(mdPlain);

/** Cached singleton: markdown-it wired to the shiki highlighter. Built once, reused forever. */
let mdShiki: MarkdownItType | null = null;
let mdShikiPromise: Promise<MarkdownItType> | null = null;

/** Ensure links open in a new tab with noreferrer, like the old hand-rolled renderer. */
function patchLinkTarget(md: MarkdownItType) {
	const defaultRender: RendererRule = md.renderer.rules["link_open"] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
	md.renderer.rules["link_open"] = (tokens, idx, options, env, self: Renderer) => {
		tokens[idx].attrSet("target", "_blank");
		tokens[idx].attrSet("rel", "noreferrer");
		return defaultRender(tokens, idx, options, env, self);
	};
}

async function buildShikiMd(): Promise<MarkdownItType> {
	const highlighter: HighlighterCore = await createHighlighterCore({
		themes: [githubLight],
		langs: HIGHLIGHT_LANGS,
		engine: createJavaScriptRegexEngine(),
	});
	const plugin = fromHighlighter(highlighter, {
		theme: HIGHLIGHT_THEME,
		defaultLanguage: TEXT_LANG,
		// Unknown fence languages (```ruby etc.) degrade to plain text instead of throwing.
		fallbackLanguage: TEXT_LANG,
	});
	const md = new MarkdownIt({ html: false, linkify: true });
	md.use(plugin);
	patchLinkTarget(md);
	return md;
}

function getShikiMd(): Promise<MarkdownItType> {
	mdShikiPromise ??= buildShikiMd().then((md) => {
		mdShiki = md;
		return md;
	});
	return mdShikiPromise;
}

// Kick off the highlighter warm-up immediately so the first render is highlighted.
void getShikiMd();

/**
 * Render markdown → HTML. Synchronous: uses the cached shiki instance once ready, otherwise the
 * plain markdown-it fallback (the async highlighter build never blocks rendering).
 */
export function renderMarkdown(src: string): string {
	return (mdShiki ?? mdPlain).render(src);
}

/**
 * Render markdown → HTML, waiting for the highlighter if it is still warming up.
 * Use at mount/startup when you want highlighting guaranteed on first paint.
 */
export async function renderMarkdownReady(src: string): Promise<string> {
	const md = await getShikiMd();
	return md.render(src);
}
