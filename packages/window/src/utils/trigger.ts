const WHITESPACE = /[\t\n\r ]/;
const WORD = /[A-Za-z0-9_]/;

export interface ComposerTriggerToken {
	readonly trigger: string;
	readonly query: string;
	readonly span: { readonly start: number; readonly end: number };
}

function boundaryOk(draft: string, at: number, triggers: ReadonlySet<string>): boolean {
	if (at === 0) return true;
	const prev = draft.charAt(at - 1);
	if (WHITESPACE.test(prev)) return true;
	if (prev === "/" || prev === "@" || prev === ":" || triggers.has(prev)) return false;
	return !WORD.test(prev);
}

export function detectComposerTrigger(draft: string, caret: number, triggers: ReadonlySet<string>): ComposerTriggerToken | null {
	for (let at = caret - 1; at >= 0; at -= 1) {
		const char = draft.charAt(at);
		if (WHITESPACE.test(char)) return null;
		if (!triggers.has(char)) continue;
		if (!boundaryOk(draft, at, triggers)) continue;
		return { trigger: char, query: draft.slice(at + 1, caret), span: { start: at, end: caret } };
	}
	return null;
}
