/**
 * Trigger detection (pure, DOM-free): from the caret scan left for a '/' (commands) or an '@'
 * (partners) at a word boundary. This is not string.includes — URL slashes, user@host, an e-mail's
 * '@' and the second slash of '//' never trigger.
 */
export interface TriggerToken {
	trigger: "/" | "@";
	query: string;
	position: "leading" | "inline";
	span: { start: number; end: number };
}

const WHITESPACE = /[\t\n\r ]/;

function boundaryOk(draft: string, i: number): boolean {
	if (i === 0) return true;
	const prev = draft.charAt(i - 1);
	if (WHITESPACE.test(prev)) return true;
	// '//' second slash, user@host-style prefixes and URL scheme slashes are not command boundaries.
	if (prev === "/" || prev === "@" || prev === ":") return false;
	// A slash glued to a word (URL path, file path) is not a command boundary.
	return !/[A-Za-z0-9_]/.test(prev);
}

export function detectTrigger(draft: string, caret: number): TriggerToken | null {
	for (let i = caret - 1; i >= 0; i--) {
		const ch = draft.charAt(i);
		if (WHITESPACE.test(ch)) return null;
		if (ch !== "/" && ch !== "@") continue;
		if (!boundaryOk(draft, i)) continue;
		return {
			trigger: ch,
			query: draft.slice(i + 1, caret),
			position: i === 0 ? "leading" : "inline",
			span: { start: i, end: caret },
		};
	}
	return null;
}

/** Exact command-name parse (mirrors the Bun-side parseCommand). */
const COMMAND_RE = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u;

export function parseCommand(line: string): { name: string; rawInput: string } | null {
	const match = COMMAND_RE.exec(line);
	if (!match) return null;
	return { name: match[1], rawInput: line.slice(match[0].length) };
}
