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
import MarkdownIt, { type MarkdownIt as MarkdownItType, type Renderer, type RendererRule, type Token } from "markdown-it";
import { resolveMentionToken } from "../../shared/file-mentions";

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
patchFileMentions(mdPlain);

/** Cached singleton: markdown-it wired to the shiki highlighter. Built once, reused forever. */
let mdShiki: MarkdownItType | null = null;
let mdShikiPromise: Promise<MarkdownItType> | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;

/** Ensure links open in a new tab with noreferrer, like the old hand-rolled renderer. An external
 * http(s) link is dressed exactly like the one `code_inline` produces: the `md-inline-url` class
 * plus the trailing icon. */
function patchLinkTarget(md: MarkdownItType) {
	const defaultOpen: RendererRule = md.renderer.rules["link_open"] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
	md.renderer.rules["link_open"] = (tokens, idx, options, env, self: Renderer) => {
		const href = tokens[idx].attrGet("href");
		const external = href !== null && httpUrl(String(href)) !== null;
		tokens[idx].attrSet("target", "_blank");
		tokens[idx].attrSet("rel", "noreferrer");
		if (external) tokens[idx].attrSet("class", "md-inline-url");
		return defaultOpen(tokens, idx, options, env, self);
	};
	const defaultClose: RendererRule = md.renderer.rules["link_close"] ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
	md.renderer.rules["link_close"] = (tokens, idx, options, env, self: Renderer) => {
		const href = enclosingLinkHref(tokens, idx);
		const close = defaultClose(tokens, idx, options, env, self);
		return href !== null && httpUrl(href) !== null ? `${EXTERNAL_ICON_SVG}${close}` : close;
	};
}

/** The href of the `link_open` that a `link_close` at `index` closes, or null outside a link. */
function enclosingLinkHref(tokens: Token[], index: number): string | null {
	let depth = 0;
	for (let i = index - 1; i >= 0; i--) {
		const type = tokens[i].type;
		if (type === "link_close") depth += 1;
		else if (type === "link_open") {
			if (depth === 0) {
				const href = tokens[i].attrGet("href");
				return href === null ? null : String(href);
			}
			depth -= 1;
		}
	}
	return null;
}

interface MentionEnv {
	files?: readonly string[];
}

/** The URL itself when it is an external http(s) one, else null — the one rule both link paths share. */
function httpUrl(value: string): string | null {
	return /^https?:\/\//i.test(value) ? value : null;
}

function insideLink(tokens: { type: string }[], index: number): boolean {
	let depth = 0;
	for (let i = index - 1; i >= 0; i--) {
		const type = tokens[i].type;
		if (type === "link_close") depth += 1;
		else if (type === "link_open") {
			if (depth === 0) return true;
			depth -= 1;
		}
	}
	return false;
}

function patchFileMentions(md: MarkdownItType) {
	md.renderer.rules["code_inline"] = (tokens, idx, _options, env, self: Renderer) => {
		const token = tokens[idx];
		const value = token.content;
		const open = `<code${self.renderAttrs(token)}>`;
		const url = httpUrl(value);
		if (url !== null) return `${open}<a class="md-inline-url" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(value)}${EXTERNAL_ICON_SVG}</a></code>`;
		const files = (env as MentionEnv | undefined)?.files;
		if (files !== undefined && !insideLink(tokens, idx)) {
			const path = resolveMentionToken(value, files);
			if (path !== undefined) {
				const range = path.range === undefined ? "" : ` data-range="${path.range.start}-${path.range.end}"`;
				const label = `Open ${escapeHtml(path.path)}${path.range === undefined ? "" : ` at line ${path.range.start}`}`;
				return `${open}<button type="button" class="md-file-mention" data-path="${escapeHtml(path.path)}"${range} title="${escapeHtml(path.path)}" aria-label="${label}">${escapeHtml(value)}</button></code>`;
			}
		}
		return `${open}${escapeHtml(value)}</code>`;
	};
}

/**
 * Build the shiki-wired markdown-it instance. All shiki modules are dynamic imports so the bundler
 * code-splits them into a lazy chunk — the main bundle only pays for markdown-it + app code.
 */
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

	const instance = await createHighlighterCore({
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
	return instance;
}

function getHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= buildHighlighter();
	return highlighterPromise;
}

async function buildShikiMd(): Promise<MarkdownItType> {
	const [{ fromHighlighter }, instance] = await Promise.all([import("@shikijs/markdown-it/core"), getHighlighter()]);
	const plugin = fromHighlighter(instance, {
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
	patchFileMentions(md);
	return md;
}

function getShikiMd(): Promise<MarkdownItType> {
	mdShikiPromise ??= buildShikiMd().then((md) => {
		mdShiki = md;
		return md;
	});
	return mdShikiPromise;
}

const EXTENSION_LANGS: Record<string, string> = {
	ts: "ts",
	mts: "ts",
	cts: "ts",
	tsx: "tsx",
	js: "js",
	mjs: "js",
	cjs: "js",
	jsx: "jsx",
	py: "python",
	pyw: "python",
	html: "html",
	htm: "html",
	css: "css",
	json: "json",
	jsonc: "jsonc",
	md: "markdown",
	mdx: "markdown",
	markdown: "markdown",
	yml: "yaml",
	yaml: "yaml",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	sql: "sql",
	toml: "toml",
	ini: "ini",
	cfg: "ini",
	diff: "diff",
	patch: "diff",
	xml: "xml",
	svg: "xml",
};

export function languageForPath(path: string): string | null {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return null;
	return EXTENSION_LANGS[base.slice(dot + 1).toLowerCase()] ?? null;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface HighlightToken {
	content: string;
	htmlStyle?: Record<string, string>;
}

export interface HighlightLine {
	tokens: HighlightToken[];
}

export async function highlightCodeToLines(code: string, lang?: string | null): Promise<HighlightLine[]> {
	const instance = await getHighlighter();
	const result = instance.codeToTokens(code, {
		lang: lang ?? "text",
		themes: { light: "github-light", dark: "github-dark" },
		defaultColor: "light-dark()",
	});
	return result.tokens.map((line) => ({
		tokens: line.map((token) => ({ content: token.content, htmlStyle: token.htmlStyle })),
	}));
}

export async function highlightCode(code: string, lang?: string | null): Promise<string> {
	const instance = await getHighlighter();
	try {
		return instance.codeToHtml(code, {
			lang: lang ?? "text",
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: "light-dark()",
		});
	} catch {
		return `<pre class="shiki" style="background-color:var(--color-print-tint)"><code>${escapeHtml(code)}</code></pre>`;
	}
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
export function renderMarkdown(src: string, files?: readonly string[]): string {
	return withCopyButtons((mdShiki ?? mdPlain).render(src, files === undefined ? undefined : { files }));
}

/** Plain markdown (no shiki code highlighting) — fast synchronous first paint. Callers upgrade
 * to `renderMarkdown` asynchronously when the browser is idle for the highlighted version. */
export function renderMarkdownPlain(src: string, files?: readonly string[]): string {
	return withCopyButtons(mdPlain.render(src, files === undefined ? undefined : { files }));
}

/**
 * Render markdown → HTML, waiting for the highlighter if it is still warming up.
 * Use at mount/startup when you want highlighting guaranteed on first paint.
 */
export async function renderMarkdownReady(src: string, files?: readonly string[]): Promise<string> {
	const md = await getShikiMd();
	return withCopyButtons(md.render(src, files === undefined ? undefined : { files }));
}

export const EXTERNAL_ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

/** Inline lucide icons for the code-copy button (innerHTML-safe). */
export const COPY_ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
export const COPIED_ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/** Wrap every fenced code block with a hover copy button (`.md-code` + `.md-copy`). */
function withCopyButtons(html: string): string {
	return html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (_match, attrs: string, body: string) => {
		return `<div class="md-code"><button type="button" class="md-copy" aria-label="Copy code">${COPY_ICON_SVG}</button><pre${attrs}>${body}</pre></div>`;
	});
}
