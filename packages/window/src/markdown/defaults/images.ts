import type { MarkdownIt } from "markdown-it";

import { renderImageHtml } from "../html.ts";
import type { MarkdownEnv, MarkdownPlugin } from "../types.ts";

export function installImages(md: MarkdownIt): void {
	md.renderer.rules["image"] = (tokens, index, options, env, self) => {
		const token = tokens[index];
		if (!token) return "";
		const src = String(token.attrGet("src") ?? "");
		const alt = self.renderInlineAsText(token.children ?? [], options, env);
		return renderImageHtml(src, alt, {}, (env as MarkdownEnv).images);
	};
}

export const imagesPlugin: MarkdownPlugin = { id: "images", order: 15, setup: installImages };
