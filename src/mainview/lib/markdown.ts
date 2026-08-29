/**
 * Markdown → HTML renderer: markdown-it (full CommonMark) + shiki (TextMate highlighting).
 *
 * The render path is synchronous: `renderMarkdown` never blocks. The shiki stack is a cached
 * singleton built once (async warm-up) and reused forever; until it is ready a plain markdown-it
 * instance renders without highlighting.
 *
 * Bundle strategy (performance): markdown-it stays in the main chunk (it's on every message's hot
 * path), but the whole shiki stack — core, JS regex engine, the six grammars, and the theme — is
 * imported via dynamic `import()` inside the builder, so Vite/Rolldown emits it as a separate chunk
 * that loads only on first code-block render. The warm-up is kicked off from App mount
 * (`warmUpMarkdown`), off the module-load critical path, so cold start doesn't pay for the
 * highlighter build unless/until it's needed.
 *
 * HTML is escaped by markdown-it (`html: false`), so user content is never executed as tags.
 */

import type { MarkdownItShikiSetupOptions } from "@shikijs/markdown-it/core";
import type { HighlighterCore } from "@shikijs/types";
import MarkdownIt, { type MarkdownIt as MarkdownItType, type Renderer, type RendererRule } from "markdown-it";

// Dual shiki themes: with `defaultColor: "light-dark()"` every token color is emitted as an
// inline `light-dark(#light, #dark)` pair, resolved by the app's color-scheme — so code blocks
// follow the theme (data-theme / system) instantly, no re-render needed on a theme switch.
// shiki treats "text" as the built-in plain-text language at runtime, but it is not a member of the
// BundledLanguage union — cast it through unknown once.
const TEXT_LANG = "text" as unknown as MarkdownItShikiSetupOptions["defaultLanguage"];

/**
 * CJK-friendly emphasis flanking for `*` / `~` delimiters.
 *
 * CommonMark's flanking rule makes a delimiter run between a punctuation character and a
 * non-punctuation, non-whitespace character non-flanking in one direction. Chinese text often
 * glues `**加粗（x）**中文` with no spaces, so the closing `**` (after `）`) cannot close and the
 * asterisks render literally. This patch lets `*` / `~` delimiters open/close when the neighboring
 * character is a Han ideograph:
 *
 *   `**...（x）**包` — `**` after CJK punctuation, before Han → can close
 *   `包**（x）**...` — `**` after Han, before CJK punctuation → can open
 *
 * `_` keeps strict CommonMark behavior (no intraword `_` emphasis).
 */
function patchCjkFriendlyFlanking(): void {
	const State = MarkdownIt.StateInline;
	const original = State.prototype.scanDelims;
	State.prototype.scanDelims = function (this: InstanceType<typeof State>, start: number, canSplitWord: boolean) {
		const scanned = original.call(this, start, canSplitWord);
		// Only `*` (and `~`) delimiters may split words; `_` keeps the strict intraword rule.
		if (!canSplitWord) return scanned;
		const src = this.src;
		if (isHanCodePoint(src.codePointAt(start + scanned.length))) {
			scanned.can_close = true;
		}
		if (isHanCodePoint(codePointBefore(src, start))) {
			scanned.can_open = true;
		}
		return scanned;
	};
}
patchCjkFriendlyFlanking();

/** Code point of the character immediately before `index`, or undefined at the start. */
function codePointBefore(src: string, index: number): number | undefined {
	if (index <= 0) return undefined;
	const prev = index - 1;
	const code = src.charCodeAt(prev);
	// If `prev` is a low surrogate, the code point starts one position earlier.
	if (code >= 0xdc00 && code <= 0xdfff && prev > 0) {
		const high = src.charCodeAt(prev - 1);
		if (high >= 0xd800 && high <= 0xdbff) return src.codePointAt(prev - 1) ?? undefined;
	}
	return src.codePointAt(prev) ?? undefined;
}

/** True when the code point is a CJK Unified/Compatibility Ideograph (Han character). */
function isHanCodePoint(code: number | undefined): boolean {
	if (code === undefined) return false;
	return (
		(code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
		(code >= 0x3400 && code <= 0x4dbf) || // Extension A
		(code >= 0xf900 && code <= 0xfaff) || // Compatibility Ideographs
		(code >= 0x20000 && code <= 0x2a6df) || // Extension B
		(code >= 0x2a700 && code <= 0x2ebef) || // Extensions C–F
		(code >= 0x30000 && code <= 0x323af) // Extension G
	);
}

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

/**
 * Build the shiki-wired markdown-it instance. All shiki modules are dynamic imports so the bundler
 * code-splits them into a lazy chunk — the main bundle only pays for markdown-it + app code.
 */
async function buildShikiMd(): Promise<MarkdownItType> {
	const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, { fromHighlighter }, ts, tsx, js, python, html, css, githubLight, githubDark] = await Promise.all([
		import("shiki/core"),
		import("shiki/engine/javascript"),
		import("@shikijs/markdown-it/core"),
		import("shiki/langs/ts.mjs"),
		import("shiki/langs/tsx.mjs"),
		import("shiki/langs/js.mjs"),
		import("shiki/langs/python.mjs"),
		import("shiki/langs/html.mjs"),
		import("shiki/langs/css.mjs"),
		import("shiki/themes/github-light.mjs"),
		import("shiki/themes/github-dark.mjs"),
	]);

	const highlighter: HighlighterCore = await createHighlighterCore({
		themes: [githubLight.default, githubDark.default],
		langs: [ts.default, tsx.default, js.default, python.default, html.default, css.default],
		engine: createJavaScriptRegexEngine(),
	});
	const plugin = fromHighlighter(highlighter, {
		themes: { light: "github-light", dark: "github-dark" },
		// Token colors ride light-dark() pairs (see above); the surface comes from the app's
		// print-tint token (style.css) instead of the themes' own backgrounds.
		defaultColor: "light-dark()",
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

/**
 * Kick off the highlighter build. Call from app mount (after first paint) so cold start doesn't
 * compete with the lazy shiki chunk; no-op once the singleton is built.
 */
export function warmUpMarkdown(): void {
	void getShikiMd();
}

/**
 * Render markdown → HTML. Synchronous: uses the cached shiki instance once ready, otherwise the
 * plain markdown-it fallback (the async highlighter build never blocks rendering).
 */
export function renderMarkdown(src: string): string {
	return (mdShiki ?? mdPlain).render(src);
}

/** Plain markdown (no shiki code highlighting) — fast synchronous first paint. Callers upgrade
 * to `renderMarkdown` asynchronously when the browser is idle for the highlighted version. */
export function renderMarkdownPlain(src: string): string {
	return mdPlain.render(src);
}

/**
 * Render markdown → HTML, waiting for the highlighter if it is still warming up.
 * Use at mount/startup when you want highlighting guaranteed on first paint.
 */
export async function renderMarkdownReady(src: string): Promise<string> {
	const md = await getShikiMd();
	return md.render(src);
}
