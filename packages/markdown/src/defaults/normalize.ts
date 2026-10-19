import type { MarkdownPlugin } from "../types.ts";

const EMPHASIS_HEADING = /^(\s*)(\*\*|__)(#{1,6})[ \t]+(.+?)\2[ \t]*$/;
const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;

export function normalizeSource(text: string): string {
	if (!text.includes("**") && !text.includes("__")) return text;
	let fence: string | null = null;
	return text
		.split("\n")
		.map((line) => {
			const marker = FENCE_OPEN.exec(line)?.[1] ?? null;
			if (fence !== null) {
				if (marker !== null && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
				return line;
			}
			if (marker !== null) {
				fence = marker;
				return line;
			}
			const match = EMPHASIS_HEADING.exec(line);
			if (match === null) return line;
			const [, indent = "", emphasis = "", hashes = "", body = ""] = match;
			return `${indent}${hashes} ${emphasis}${body}${emphasis}`;
		})
		.join("\n");
}

export const normalizePlugin: MarkdownPlugin = { id: "normalize", order: 5, source: normalizeSource };
