const EMPHASIS_HEADING = /^(\s*)(\*\*|__)(#{1,6})[ \t]+(.+?)\2[ \t]*$/;
const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;

export function normalizeMarkdownSource(source: string): string {
	if (!source.includes("**") && !source.includes("__")) return source;
	let fence: string | null = null;
	return source
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
			const [, indent = "", emphasis = "", hashes = "", text = ""] = match;
			return `${indent}${hashes} ${emphasis}${text}${emphasis}`;
		})
		.join("\n");
}
