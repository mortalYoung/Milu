import type { MarkdownEnv, MarkdownPort } from "@milu/client";
import MarkdownIt, { type MarkdownIt as MarkdownItType } from "markdown-it";

import { RenderCache } from "./cache.ts";
import { DEFAULT_PLUGINS } from "./defaults/index.ts";
import type { MarkdownPlugin, MarkdownTier } from "./types.ts";

export interface Markdown extends MarkdownPort {
	dispose(): void;
}

const CACHE_LIMIT = 200;

function ordered(plugins: readonly MarkdownPlugin[]): readonly MarkdownPlugin[] {
	const sorted = [...plugins].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
	const byOrder = new Map<number, string>();
	const byId = new Set<string>();
	for (const plugin of sorted) {
		const twin = byOrder.get(plugin.order);
		if (twin !== undefined) throw new Error(`markdown plugins "${twin}" and "${plugin.id}" share order ${plugin.order}`);
		if (byId.has(plugin.id)) throw new Error(`markdown plugin "${plugin.id}" is registered twice`);
		byOrder.set(plugin.order, plugin.id);
		byId.add(plugin.id);
	}
	return sorted;
}

function instance(): MarkdownItType {
	return new MarkdownIt({ html: false, linkify: true });
}

function install(md: MarkdownItType, plugins: readonly MarkdownPlugin[], tier: MarkdownTier): void {
	for (const plugin of plugins) {
		if (tier === "both" && plugin.tier === "full") continue;
		if (!plugin.setup) continue;
		const result = plugin.setup(md);
		if (result !== undefined && typeof (result as Promise<void>).then === "function") {
			throw new Error(`markdown plugin "${plugin.id}" is async — declare tier "full"`);
		}
	}
}

async function installFull(plugins: readonly MarkdownPlugin[]): Promise<MarkdownItType> {
	const md = instance();
	for (const plugin of plugins) {
		if (!plugin.setup) continue;
		try {
			await plugin.setup(md);
		} catch (error) {
			console.error(`markdown plugin "${plugin.id}" did not install`, error);
		}
	}
	return md;
}

export function createMarkdown(plugins: readonly MarkdownPlugin[] = DEFAULT_PLUGINS): Markdown {
	const rules = ordered(plugins);
	const plain = instance();
	install(plain, rules, "both");

	const caches = { plain: new RenderCache(CACHE_LIMIT), full: new RenderCache(CACHE_LIMIT) };
	let full: Promise<MarkdownItType> | null = null;

	const sourceOf = (text: string, env: MarkdownEnv, tier: MarkdownTier): string => {
		let out = text;
		for (const plugin of rules) {
			if (tier === "both" && plugin.tier === "full") continue;
			if (plugin.source) out = plugin.source(out, env);
		}
		return out;
	};

	const htmlOf = (html: string, env: MarkdownEnv, tier: MarkdownTier): string => {
		let out = html;
		for (const plugin of rules) {
			if (tier === "both" && plugin.tier === "full") continue;
			if (plugin.html) out = plugin.html(out, env);
		}
		return out;
	};

	const paint = (md: MarkdownItType, cache: RenderCache, tier: MarkdownTier, text: string, env: MarkdownEnv): string => {
		const cacheable = Object.keys(env).length === 0;
		const hit = cacheable ? cache.get(text) : undefined;
		if (hit !== undefined) return hit;
		const html = htmlOf(md.render(sourceOf(text, env, tier)), env, tier);
		if (cacheable) cache.set(text, html);
		return html;
	};

	const fullInstance = (): Promise<MarkdownItType> => {
		full ??= installFull(rules);
		return full;
	};

	return {
		render(text, env = {}) {
			return paint(plain, caches.plain, "both", text, env);
		},
		async renderFull(text, env = {}) {
			return paint(await fullInstance(), caches.full, "full", text, env);
		},
		dispose() {
			caches.plain.clear();
			caches.full.clear();
			full = null;
		},
	};
}
