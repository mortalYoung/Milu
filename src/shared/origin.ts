import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENT_META, entryKey } from "./entry-meta";

function isUsable(entry: Entry): boolean {
	return entry != null && typeof entry.id === "string" && entry.id.length > 0;
}

export function projectOrigin(raw: Entry[]): Entry[] {
	const out: Entry[] = [];
	for (const entry of raw) {
		if (!isUsable(entry)) continue;
		const meta = EVENT_META[entryKey(entry)];
		if (meta?.origin?.visit) meta.origin.visit(entry, out);
		else out.push(entry);
	}
	return out;
}

/** Where a conversation begins: a prompt the reader sent. One conversation runs from here to just
 *  before the next prompt — its tool rounds, follow-up continuations and archived tail included — so a
 *  page cut anywhere else would show half an exchange. A run that nobody prompted (a command, a skill,
 *  a shell run) rides along with the conversation it followed. */
function conversationStarts(origin: Entry[]): number[] {
	const out: number[] = [];
	origin.forEach((entry, index) => {
		if (entry.type === "message" && entry.message.role === "user") out.push(index);
	});
	return out;
}

function lastConversations(starts: number[], conversations: number, before: number): number {
	const ends = before === Number.POSITIVE_INFINITY ? starts.length : starts.filter((at) => at < before).length;
	return ends > conversations ? starts[ends - conversations]! : 0;
}

export interface OriginWindow {
	entries: Entry[];
	total: number;
	hasMore: boolean;
	reset: boolean;
}

/** A window of the log, measured in whole conversations: the newest `conversations` by default, and the
 *  same number per step when the reader walks up or the harness asks what has landed since. */
export function originWindow(origin: Entry[], options: { mode?: "older" | "newer"; cursor?: string; conversations: number }): OriginWindow {
	const { mode, cursor, conversations } = options;
	const total = origin.length;
	const starts = conversationStarts(origin);
	const page = (start: number, end: number, reset = false): OriginWindow => ({ entries: origin.slice(start, end), total, hasMore: start > 0, reset });
	if (!mode || !cursor) return page(lastConversations(starts, conversations, Number.POSITIVE_INFINITY), total);
	const at = origin.findIndex((entry) => entry.id === cursor);
	if (at < 0) return page(lastConversations(starts, conversations, Number.POSITIVE_INFINITY), total, true);
	if (mode === "older") return page(lastConversations(starts, conversations, at), at);
	const after = starts.filter((index) => index > at);
	return page(at + 1, after.length > conversations ? after[conversations]! : total);
}
