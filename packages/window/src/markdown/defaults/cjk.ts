import type { MarkdownIt, StateInline } from "markdown-it";

import type { MarkdownPlugin } from "../types.ts";

let patched = false;

function isHan(code: number | undefined): boolean {
	if (code === undefined) return false;
	return (
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0x20000 && code <= 0x2a6df) ||
		(code >= 0x2a700 && code <= 0x2ebef) ||
		(code >= 0x30000 && code <= 0x323af)
	);
}

function codePointBefore(src: string, index: number): number | undefined {
	if (index <= 0) return undefined;
	const previous = index - 1;
	const code = src.charCodeAt(previous);
	if (code >= 0xdc00 && code <= 0xdfff && previous > 0) {
		const high = src.charCodeAt(previous - 1);
		if (high >= 0xd800 && high <= 0xdbff) return src.codePointAt(previous - 1) ?? undefined;
	}
	return src.codePointAt(previous) ?? undefined;
}

export function installCjk(md: MarkdownIt): void {
	if (patched) return;
	patched = true;
	const scanDelims = md.inline.State.prototype.scanDelims;
	md.inline.State.prototype.scanDelims = function (this: StateInline, start: number, canSplitWord: boolean) {
		const scanned = scanDelims.call(this, start, canSplitWord);
		if (!canSplitWord) return scanned;
		if (isHan(this.src.codePointAt(start + scanned.length))) scanned.can_close = true;
		if (isHan(codePointBefore(this.src, start))) scanned.can_open = true;
		return scanned;
	};
}

export const cjkPlugin: MarkdownPlugin = { id: "cjk", order: 10, setup: installCjk };
