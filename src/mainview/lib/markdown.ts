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
