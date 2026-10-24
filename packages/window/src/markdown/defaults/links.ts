import type { MarkdownIt, RendererRule, Token } from "markdown-it";

import type { MarkdownPlugin } from "../types.ts";

const EXTERNAL_ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

const external = (href: string | null): boolean => href !== null && /^https?:\/\//i.test(href);

function enclosingHref(tokens: readonly Token[], index: number): string | null {
	let depth = 0;
	for (let at = index - 1; at >= 0; at -= 1) {
		const type = tokens[at]?.type;
		if (type === "link_close") depth += 1;
		else if (type === "link_open") {
			if (depth === 0) {
				const href = tokens[at]?.attrGet("href");
				return typeof href === "string" ? href : null;
			}
			depth -= 1;
		}
	}
	return null;
}

export function installLinks(md: MarkdownIt): void {
	const open: RendererRule = md.renderer.rules["link_open"] ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
	const close: RendererRule = md.renderer.rules["link_close"] ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

	md.renderer.rules["link_open"] = (tokens, index, options, env, self) => {
		const token = tokens[index];
		const raw = token?.attrGet("href");
		const href = typeof raw === "string" ? raw : null;
		token?.attrSet("target", "_blank");
		token?.attrSet("rel", "noreferrer");
		if (external(href)) token?.attrSet("class", "md-inline-url");
		return open(tokens, index, options, env, self);
	};

	md.renderer.rules["link_close"] = (tokens, index, options, env, self) => {
		const html = close(tokens, index, options, env, self);
		return external(enclosingHref(tokens, index)) ? `${EXTERNAL_ICON_SVG}${html}` : html;
	};
}

export const linksPlugin: MarkdownPlugin = { id: "links", order: 20, setup: installLinks };
