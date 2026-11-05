import type { HighlighterCore, LanguageInput, ShikiTransformer } from "shiki/core";

export const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const;

export const HIGHLIGHT_LIMITS = { tokenizeMaxLineLength: 3000, tokenizeTimeLimit: 500 } as const;

export const CORE_LANGUAGES = ["ts", "tsx", "bash"];

const LOADERS: Record<string, () => Promise<{ default: LanguageInput }>> = {
	bash: () => import("shiki/langs/bash.mjs"),
	console: () => import("shiki/langs/console.mjs"),
	css: () => import("shiki/langs/css.mjs"),
	diff: () => import("shiki/langs/diff.mjs"),
	html: () => import("shiki/langs/html.mjs"),
	ini: () => import("shiki/langs/ini.mjs"),
	js: () => import("shiki/langs/js.mjs"),
	json: () => import("shiki/langs/json.mjs"),
	jsonc: () => import("shiki/langs/jsonc.mjs"),
	jsx: () => import("shiki/langs/jsx.mjs"),
	log: () => import("shiki/langs/log.mjs"),
	markdown: () => import("shiki/langs/markdown.mjs"),
	python: () => import("shiki/langs/python.mjs"),
	sql: () => import("shiki/langs/sql.mjs"),
	toml: () => import("shiki/langs/toml.mjs"),
	ts: () => import("shiki/langs/ts.mjs"),
	tsx: () => import("shiki/langs/tsx.mjs"),
	xml: () => import("shiki/langs/xml.mjs"),
	yaml: () => import("shiki/langs/yaml.mjs"),
};

const ALIASES: Record<string, string> = {
	htm: "html",
	javascript: "js",
	md: "markdown",
	py: "python",
	shell: "bash",
	shellscript: "bash",
	sh: "bash",
	typescript: "ts",
	yml: "yaml",
	zsh: "bash",
};

const BLOCK_LIMIT = 160;
const blocks = new Map<string, string>();
const loading = new Map<string, Promise<void>>();

let highlighter: Promise<HighlighterCore> | null = null;

async function build(): Promise<HighlighterCore> {
	const [{ createHighlighterCore }, { createOnigurumaEngine }, light, dark] = await Promise.all([
		import("shiki/core"),
		import("shiki/engine/oniguruma"),
		import("shiki/themes/github-light.mjs"),
		import("shiki/themes/github-dark.mjs"),
	]);
	return createHighlighterCore({
		themes: [light.default, dark.default],
		langs: [],
		engine: createOnigurumaEngine(import("shiki/wasm")),
	});
}

export function getHighlighter(): Promise<HighlighterCore> {
	highlighter ??= build();
	return highlighter;
}

export function resolveLanguage(lang: string): string | null {
	const key = lang.trim().toLowerCase().replace(/^\./, "");
	const id = ALIASES[key] ?? key;
	return id in LOADERS ? id : null;
}

export async function ensureLanguages(langs: Iterable<string>): Promise<void> {
	const core = await getHighlighter();
	const loaded = new Set(core.getLoadedLanguages());
	await Promise.all(
		[...new Set(langs)].map((lang) => {
			const id = resolveLanguage(lang);
			if (id === null || loaded.has(id)) return undefined;
			const pending = loading.get(id);
			if (pending !== undefined) return pending;
			const job = LOADERS[id]!()
				.then((module) => core.loadLanguage(module.default))
				.then(
					() => undefined,
					() => undefined,
				)
				.finally(() => loading.delete(id));
			loading.set(id, job);
			return job;
		}),
	);
}

export async function warmLanguages(): Promise<void> {
	const core = await getHighlighter();
	await ensureLanguages(CORE_LANGUAGES);
	for (const lang of CORE_LANGUAGES) highlightWith(core, "const value = 1;", lang);
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function languageClass(lang: string): ShikiTransformer {
	return {
		name: "@milu/shiki:language",
		code(node) {
			node.properties["class"] = `language-${lang}`;
		},
	};
}

export function highlightWith(core: HighlighterCore, code: string, lang: string): string {
	const id = resolveLanguage(lang) ?? "text";
	const key = `${id}\u0000${code}`;
	const hit = blocks.get(key);
	if (hit !== undefined) {
		blocks.delete(key);
		blocks.set(key, hit);
		return hit;
	}
	let html: string;
	try {
		html = core.codeToHtml(code, { lang: id, themes: SHIKI_THEMES, defaultColor: "light-dark()", ...HIGHLIGHT_LIMITS, transformers: [languageClass(id)] });
	} catch {
		html = `<pre class="shiki"><code class="language-${id}">${escapeHtml(code)}</code></pre>`;
	}
	if (blocks.size >= BLOCK_LIMIT) {
		const oldest = blocks.keys().next().value;
		if (oldest !== undefined) blocks.delete(oldest);
	}
	blocks.set(key, html);
	return html;
}

export function highlightLines(core: HighlighterCore, code: string, lang: string): readonly string[] {
	const id = resolveLanguage(lang) ?? "text";
	try {
		const html = core.codeToHtml(code, { lang: id, themes: SHIKI_THEMES, defaultColor: "light-dark()", ...HIGHLIGHT_LIMITS });
		const open = html.indexOf("<code");
		const start = html.indexOf(">", open);
		const end = html.lastIndexOf("</code>");
		if (open < 0 || start < 0 || end < 0) return [];
		return html.slice(start + 1, end).split("\n");
	} catch {
		return [];
	}
}
