/**
 * The renderer's only door to shiki. Tokenizing happens in a worker (see shiki.worker.ts) so a large
 * file cannot freeze the UI; results are cached by language + content, because re-opening the same
 * file (switching diffs, closing and reopening the drawer) must not re-tokenize it.
 *
 * If the view's origin cannot spawn a worker — a capability question, not a preference — the same
 * work degrades to the main-thread highlighter the markdown fences already use: slower, but code
 * keeps its colour instead of going plain.
 */

import { getHighlighter, getHighlightLimits, type HighlightLine, tokenizeLines } from "./shiki-setup";

/** Source characters kept in the token cache. Tokens cost several times their source, so this is a
 *  small, deliberate ceiling: the file you are looking at, and the one you just left. */
const CACHE_SOURCE_LIMIT = 1_200_000;

interface Pending {
	code: string;
	lang: string | null;
	resolve: (lines: HighlightLine[]) => void;
	reject: (error: Error) => void;
}

const cache = new Map<string, HighlightLine[]>();
const pending = new Map<number, Pending>();
let cachedSource = 0;
let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

function remember(key: string, lines: HighlightLine[]) {
	cache.set(key, lines);
	cachedSource += key.length;
	while (cachedSource > CACHE_SOURCE_LIMIT && cache.size > 1) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
		cachedSource -= oldest.length;
	}
}

export function clearTokenCache(): void {
	cache.clear();
	cachedSource = 0;
}

async function tokenizeHere(entry: Pending): Promise<void> {
	try {
		const lines = await tokenizeLines(await getHighlighter(), entry.code, entry.lang);
		remember(`${entry.lang ?? ""}\u0000${entry.code}`, lines);
		entry.resolve(lines);
	} catch (error) {
		entry.reject(error instanceof Error ? error : new Error(String(error)));
	}
}

/** Everything in flight moves to the main thread when the worker fails, so a broken worker is a
 *  slow paint, never a missing one. */
function fallBackToMainThread(): void {
	workerBroken = true;
	const inFlight = [...pending.values()];
	pending.clear();
	for (const entry of inFlight) void tokenizeHere(entry);
}

function spawn(): Worker {
	const instance = new Worker(new URL("./shiki.worker.ts", import.meta.url), { type: "module" });
	instance.onmessage = (event: MessageEvent<{ id: number; lines?: HighlightLine[]; error?: string }>) => {
		const entry = pending.get(event.data.id);
		if (!entry) return;
		pending.delete(event.data.id);
		if (event.data.error) void tokenizeHere(entry);
		else entry.resolve(event.data.lines ?? []);
	};
	instance.onerror = () => {
		instance.terminate();
		worker = null;
		fallBackToMainThread();
	};
	return instance;
}

/** Token lines for `code`, from the cache, the worker, or (if no worker can run) this thread. */
export function highlightCodeToLines(code: string, lang?: string | null): Promise<HighlightLine[]> {
	const key = `${lang ?? ""}\u0000${code}`;
	const hit = cache.get(key);
	if (hit) return Promise.resolve(hit);

	return new Promise<HighlightLine[]>((resolve, reject) => {
		const entry: Pending = { code, lang: lang ?? null, resolve, reject };
		if (workerBroken) {
			void tokenizeHere(entry);
			return;
		}
		const id = ++seq;
		pending.set(id, entry);
		try {
			worker ??= spawn();
			worker.postMessage({ id, code, lang: entry.lang, limits: getHighlightLimits() });
		} catch {
			// No worker in this origin: sweep this request (and anything else in flight) onto the main thread.
			worker = null;
			fallBackToMainThread();
		}
	});
}
