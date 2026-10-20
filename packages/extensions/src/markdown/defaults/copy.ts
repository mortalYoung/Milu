import type { MarkdownPlugin } from "../types.ts";

const COPY_ICON =
	'<svg class="md-copy-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

const COPIED_ICON =
	'<svg class="md-copy-check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const PRE = /<pre([^>]*)>([\s\S]*?)<\/pre>/g;

function wrap(html: string): string {
	return html.replace(PRE, (_match, attrs: string, body: string) => {
		return `<div class="md-code"><button type="button" class="md-copy" aria-label="Copy code">${COPY_ICON}${COPIED_ICON}</button><pre${attrs}>${body}</pre></div>`;
	});
}

export const copyPlugin: MarkdownPlugin = { id: "copy", order: 80, html: wrap };
