import type { MarkdownPlugin } from "@milu/window/api";

const ACTION = "image.preview";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

function unescapeHtml(text: string): string {
	return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

function attribute(name: string, value: string): string {
	const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	return `${name}="${escaped}"`;
}

function attributeOf(markup: string, name: string): string | undefined {
	const match = new RegExp(`\\s${name}="([^"]*)"`).exec(markup);
	return match?.[1] === undefined ? undefined : unescapeHtml(match[1]);
}

function openTag(markup: string, attributes: string): string {
	return markup.replace(/^<([a-zA-Z]+)\b/, (_match, tag: string) => `<${tag} ${attributes}`);
}

function zoomable(markup: string, original: string | undefined): string {
	if (markup.includes("data-milu-action=")) return markup;
	const src = original ?? attributeOf(markup, "src") ?? attributeOf(markup, "data-md-src");
	if (src === undefined || src === "") return markup;
	const alt = attributeOf(markup, "alt") ?? attributeOf(markup, "title") ?? "";
	const action = attribute("data-milu-action", ACTION);
	const args = attribute("data-milu-args", JSON.stringify({ src, alt }));
	const cursor = /\sclass="/.test(markup) ? "" : ' class="cursor-zoom-in"';
	return openTag(markup, `${action} ${args}${cursor}`);
}

export const imageZoomPlugin: MarkdownPlugin = {
	id: "image.zoom",
	order: 90,

	setup(md) {
		const base = md.renderer.rules["image"] ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
		md.renderer.rules["image"] = (tokens, index, options, env, self) => {
			const original = tokens[index]?.attrGet("src");
			return zoomable(base(tokens, index, options, env, self), typeof original === "string" && original !== "" ? original : undefined);
		};
	},
};
