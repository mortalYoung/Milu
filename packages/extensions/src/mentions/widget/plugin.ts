import type { MarkdownPlugin } from "@milu/window/api";

import { resolveMentionToken } from "../lib/token.ts";

interface LinkToken {
	readonly type: string;
}

/** Markdown-it renders a flat token stream: a `link_open` still unmatched at this index means we are inside one. */
function insideLink(tokens: readonly LinkToken[], index: number): boolean {
	let depth = 0;
	for (let at = 0; at < index; at += 1) {
		const token = tokens[at];
		if (token === undefined) continue;
		if (token.type === "link_close") depth += 1;
		else if (token.type === "link_open") {
			if (depth === 0) return true;
			depth -= 1;
		}
	}
	return false;
}

export const mentionsPlugin: MarkdownPlugin = {
	id: "mentions.files",
	order: 200,

	setup(md) {
		const escape = md.utils.escapeHtml;
		md.renderer.rules["code_inline"] = (tokens, index, _options, env, self) => {
			const token = tokens[index];
			if (token === undefined) return "";
			const value = token.content;
			const files = (env as { files?: readonly string[] } | undefined)?.files;
			const target = files === undefined || insideLink(tokens, index) ? undefined : resolveMentionToken(value, files);
			if (target === undefined) return `<code${self.renderAttrs(token)}>${escape(value)}</code>`;
			const line = target.line === undefined ? "" : ` data-line="${target.line}"`;
			const where = target.line === undefined ? escape(target.path) : `${escape(target.path)} at line ${target.line}`;
			token.attrJoin("class", "md-mention-chip");
			return `<code${self.renderAttrs(token)}><button type="button" class="md-file-mention" data-path="${escape(target.path)}"${line} title="${where}" aria-label="Open ${where} in the explorer">${escape(value)}</button></code>`;
		};
	},
};
