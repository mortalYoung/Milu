import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENTS } from "./events";
import type { ViewItem } from "./rpc";

const DELIVERED_BY = "harness-delivery";

interface EntryData {
	callId?: unknown;
	name?: unknown;
	args?: unknown;
	isError?: unknown;
	toolCallId?: unknown;
	text?: unknown;
}

// ——— produced paths ———

type Producer = (args: unknown) => string | null;

const PRODUCERS: Record<string, Producer> = {
	write: (args) => {
		const record = parseRecord(args) as { path?: unknown; content?: unknown } | null;
		if (record === null) return null;
		const target = nonEmptyString(record.path);
		return target !== null && typeof record.content === "string" ? target : null;
	},
	edit: (args) => {
		const record = parseRecord(args) as { path?: unknown; edits?: unknown; oldText?: unknown; newText?: unknown } | null;
		if (record === null) return null;
		const target = nonEmptyString(record.path);
		return target !== null && hasChangingEdit(record.edits, record.oldText, record.newText) ? target : null;
	},
};

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value === "string") {
		try {
			return parseRecord(JSON.parse(value));
		} catch {
			return null;
		}
	}
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] | null {
	if (Array.isArray(value)) return value;
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function hasChangingEdit(edits: unknown, oldText: unknown, newText: unknown): boolean {
	const list = asArray(edits) ?? [{ oldText, newText }];
	for (const edit of list) {
		const record = parseRecord(edit) as { oldText?: unknown; newText?: unknown } | null;
		if (record === null) continue;
		const before = nonEmptyString(record.oldText);
		if (before !== null && typeof record.newText === "string" && before !== record.newText) return true;
	}
	return false;
}

// ——— mention matching ———

export interface MentionTarget {
	path: string;
	range?: { start: number; end: number };
}

const MENTION_WITH_RANGE = /^(.+?)[:#](\d+(?:-\d+)?)$/;

export function parseLineRange(value: string | null | undefined): { start: number; end: number } | null {
	if (!value) return null;
	const match = /^(\d+)(?:-(\d+))?$/.exec(value);
	if (match === null) return null;
	const start = Number(match[1]);
	const end = match[2] === undefined ? start : Number(match[2]);
	return start >= 1 && end >= start ? { start, end } : null;
}

export function parseMentionToken(token: string): MentionTarget {
	const match = MENTION_WITH_RANGE.exec(token);
	if (match === null) return { path: token };
	const range = parseLineRange(match[2]);
	return range === null ? { path: token } : { path: match[1], range };
}

export function resolveMentionToken(token: string, paths: readonly string[]): MentionTarget | undefined {
	const target = parseMentionToken(token);
	if (target.path === "") return undefined;
	if (paths.includes(target.path)) return target;
	const matches = paths.filter((path) => endsWithSegments(path, target.path));
	return matches.length === 1 ? { ...target, path: matches[0] } : undefined;
}

function endsWithSegments(path: string, suffix: string): boolean {
	return path.endsWith(`/${suffix}`) || path.endsWith(`\\${suffix}`);
}

export function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function workspacePath(path: string, baseDir: string | null | undefined): string {
	if (path === "" || isAbsolutePath(path) || !baseDir) return path;
	const base = baseDir.endsWith("/") ? baseDir.slice(0, -1) : baseDir;
	return `${base}/${path}`;
}

export function workspaceRelativePath(path: string, root: string | null | undefined): string {
	if (path === "" || !root) return path;
	const base = root.endsWith("/") ? root : `${root}/`;
	return path.startsWith(base) ? path.slice(base.length) : path;
}

function insideWorkspace(path: string, baseDir: string | null): boolean {
	return baseDir !== null && !isAbsolutePath(workspaceRelativePath(path, baseDir));
}

// ——— view attachment ———

export function attachMentionFiles(entries: Entry[], items: ViewItem[], baseDir: string | null): void {
	const callPath = new Map<string, string | null>();
	const producedRun = new Map<string, number>();
	const produced: { run: number; seq: number; path: string }[] = [];
	const closing = new Map<number, { id: string; seq: number }>();
	const closed = new Set<number>();
	let runKey = 0;
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		const data = (entry.data ?? {}) as EntryData;
		if (entry.customType === EVENTS.agentStart) {
			runKey = entry.seq;
			continue;
		}
		if (entry.customType === EVENTS.toolCall) {
			const callId = nonEmptyString(data.callId);
			if (callId === null) continue;
			const name = nonEmptyString(data.name);
			callPath.set(callId, name !== null ? (PRODUCERS[name]?.(data.args) ?? null) : null);
			producedRun.set(callId, runKey);
		} else if (entry.customType === EVENTS.toolResult) {
			if (data.isError === true) continue;
			const callId = nonEmptyString(data.toolCallId);
			const path = callId !== null ? (callPath.get(callId) ?? null) : null;
			if (callId === null || path === null) continue;
			const absolute = workspacePath(path, baseDir);
			if (!insideWorkspace(absolute, baseDir)) continue;
			produced.push({ run: producedRun.get(callId) ?? runKey, seq: entry.seq, path: absolute });
		} else if (entry.customType === EVENTS.sendMessage) {
			if (nonEmptyString(data.toolCallId) !== DELIVERED_BY) continue;
			if (nonEmptyString(data.text) === null) continue;
			closing.set(runKey, { id: entry.id, seq: entry.seq });
		} else if (entry.customType === EVENTS.agentEnd) {
			closed.add(runKey);
		}
	}

	const byItem = new Map<string, string[]>();
	for (const [owner, mark] of closing) {
		if (!closed.has(owner)) continue;
		const files: string[] = [];
		for (const item of produced) {
			if (item.run !== owner || item.seq > mark.seq || files.includes(item.path)) continue;
			files.push(item.path);
		}
		if (files.length > 0) byItem.set(mark.id, files);
	}

	for (const item of items) {
		const files = byItem.get(item.id);
		if (files !== undefined) item.files = files;
	}
}
