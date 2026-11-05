import type { Entry } from "@earendil-works/pi-agent-core";

import { EVENTS } from "./events.ts";

function usable(entry: Entry): boolean {
	return entry != null && typeof entry.id === "string" && entry.id.length > 0;
}

function isRequestHeader(entry: Entry): boolean {
	return entry.type === "custom" && entry.customType === EVENTS.requestHeader;
}

export function projectOrigin(raw: readonly Entry[]): Entry[] {
	const out: Entry[] = [];
	for (const entry of raw) {
		if (!usable(entry)) continue;
		if (isRequestHeader(entry)) {
			if (!out.some(isRequestHeader)) out.push(entry);
			continue;
		}
		out.push(entry);
	}
	return out;
}

export function projectTail(entries: readonly Entry[]): Entry[] {
	return entries.filter((entry) => usable(entry) && !isRequestHeader(entry));
}

function conversationStarts(origin: readonly Entry[]): number[] {
	const out: number[] = [];
	origin.forEach((entry, index) => {
		if (entry.type === "message" && entry.message.role === "user") out.push(index);
	});
	return out;
}

function lastConversations(starts: readonly number[], conversations: number, before: number): number {
	const ends = before === Number.POSITIVE_INFINITY ? starts.length : starts.filter((at) => at < before).length;
	return ends > conversations ? starts[ends - conversations]! : 0;
}

export interface OriginWindow {
	readonly entries: readonly Entry[];
	readonly total: number;
	readonly hasMore: boolean;
	readonly reset: boolean;
}

export function tailWindow(entries: readonly Entry[], conversations: number, whole: boolean): OriginWindow | null {
	const origin = whole ? projectOrigin(entries) : projectTail(entries);
	if (!whole && conversationStarts(origin).length <= conversations) return null;
	return originWindow(origin, { conversations });
}

export function originWindow(origin: readonly Entry[], options: { mode?: "older" | "newer"; cursor?: string; conversations: number }): OriginWindow {
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
