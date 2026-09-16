import { parse } from "yaml";

/** A `---` head at the very start of a document, closed by a `---` line. CRLF or LF. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface Frontmatter {
	/** Where the body starts — the head block plus the newline that closes it. */
	end: number;
	/** The head's text, verbatim, for when it is not a YAML mapping we can draw as fields. */
	raw: string;
	/** Null when the head is there but does not parse into a mapping. */
	data: Record<string, unknown> | null;
}

/**
 * Split a leading YAML head off a document. Null only when there is no head at all: a head that
 * fails to parse still comes back, with `data: null` and its text intact — real files carry broken
 * YAML (this repo's own DESIGN.md does), and raw text must not fall through to the markdown parser.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
	const match = FRONTMATTER_RE.exec(text);
	if (!match) return null;
	const raw = match[1] ?? "";
	try {
		const data = parse(raw);
		if (data && typeof data === "object" && !Array.isArray(data)) return { end: match[0].length, raw, data: data as Record<string, unknown> };
	} catch {}
	return { end: match[0].length, raw, data: null };
}
