/**
 * Tokenizes code off the main thread. The renderer is one thread: tokenizing a whole file there
 * freezes typing, scrolling and every animation (measured: 579 ms per side for a 102 KB file, ~2.8 s
 * for the 512 KB ceiling, doubled for a diff). Here a long document costs the UI nothing.
 */

import { createHighlighter, type HighlightLimits, type HighlightLine, tokenizeLines } from "./shiki-setup";

interface TokenizeRequest {
	id: number;
	code: string;
	lang: string | null;
	limits: HighlightLimits;
}

let highlighter: ReturnType<typeof createHighlighter> | null = null;

self.onmessage = async (event: MessageEvent<TokenizeRequest>) => {
	const { id, code, lang, limits } = event.data;
	try {
		highlighter ??= createHighlighter();
		const lines: HighlightLine[] = await tokenizeLines(await highlighter, code, lang, limits);
		self.postMessage({ id, lines });
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
};
