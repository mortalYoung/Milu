import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { createServiceId, type Service } from "@milu/di";
import type { Entry } from "@milu/protocol";

import { readEntries } from "../session/log.ts";

export interface TranscriptEntry {
	readonly id: string;
	readonly at: number;
	readonly role: string;
	readonly text: string;
}

export interface TranscriptHit {
	readonly id: string;
	readonly at: number;
	readonly role: string;
	readonly snippet: string;
}

export const MAX_TRANSCRIPT_CHARS = 8_000;
export const MAX_TRANSCRIPT_ENTRY_CHARS = 1_200;
const SNIPPET_CHARS = 240;
const SKIP_DIRS = new Set([".memory"]);

interface Index {
	readonly files: Map<string, number>;
	readonly entries: readonly Entry[];
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const part = block as { type?: unknown; text?: unknown };
		if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
	}
	return parts.join("\n");
}

function entryOf(entry: Entry): TranscriptEntry {
	const message = (entry as { message?: { role?: unknown; content?: unknown } }).message;
	const role = typeof message?.role === "string" ? message.role : "note";
	return { id: entry.id, at: entry.timestamp, role, text: contentText(message?.content) };
}

function tokensOf(query: string): readonly (readonly string[])[] {
	return query
		.split("|")
		.map((alternative) =>
			alternative
				.toLowerCase()
				.split(/[^\p{L}\p{N}_]+/u)
				.filter((token) => token.length > 1),
		)
		.filter((alternative) => alternative.length > 0);
}

function snippet(text: string, needle: string, size = SNIPPET_CHARS): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= size) return flat;
	const at = needle ? flat.toLowerCase().indexOf(needle.toLowerCase()) : -1;
	const start = at <= 0 ? 0 : Math.max(0, Math.min(flat.length - size, at - Math.floor(size / 3)));
	return `${start > 0 ? "…" : ""}${flat.slice(start, start + size)}${start + size < flat.length ? "…" : ""}`;
}

export class TranscriptService implements Service {
	private readonly _indices = new Map<string, Index>();

	async find(dir: string, ids: readonly string[], budget = MAX_TRANSCRIPT_CHARS): Promise<readonly TranscriptEntry[]> {
		const wanted = new Set(ids);
		const out: TranscriptEntry[] = [];
		let used = 0;
		for (const entry of await this._entries(dir)) {
			if (!wanted.has(entry.id)) continue;
			const found = entryOf(entry);
			const text = found.text.length > MAX_TRANSCRIPT_ENTRY_CHARS ? `${found.text.slice(0, MAX_TRANSCRIPT_ENTRY_CHARS)}… (truncated)` : found.text;
			if (used + text.length > budget && out.length > 0) break;
			out.push({ ...found, text });
			used += text.length;
			if (out.length === wanted.size) break;
		}
		return out;
	}

	async search(dir: string, query: string, limit = 5): Promise<readonly TranscriptHit[]> {
		const alternatives = tokensOf(query);
		if (alternatives.length === 0) return [];
		const scored: { hit: TranscriptHit; score: number }[] = [];
		for (const entry of await this._entries(dir)) {
			const found = entryOf(entry);
			if (found.text === "") continue;
			const haystack = found.text.toLowerCase();
			let score = 0;
			for (const alternative of alternatives) {
				if (!alternative.every((token) => haystack.includes(token))) continue;
				for (const token of alternative) score += haystack.split(token).length - 1;
			}
			if (score === 0) continue;
			scored.push({ hit: { id: found.id, at: found.at, role: found.role, snippet: snippet(found.text, alternatives[0]?.[0] ?? "") }, score });
		}
		scored.sort((left, right) => right.score - left.score || right.hit.at - left.hit.at);
		return scored.slice(0, limit).map((each) => each.hit);
	}

	dispose(): void {
		this._indices.clear();
	}

	private async _entries(dir: string): Promise<readonly Entry[]> {
		const files = await this._files(dir);
		const cached = this._indices.get(dir);
		if (cached !== undefined && sameFiles(cached.files, files)) return cached.entries;
		const entries: Entry[] = [];
		for (const path of files.keys()) entries.push(...(await readEntries(path).catch(() => [])));
		entries.sort((left, right) => left.timestamp - right.timestamp || left.seq - right.seq);
		this._indices.set(dir, { files, entries });
		return entries;
	}

	private async _files(dir: string): Promise<Map<string, number>> {
		const files = new Map<string, number>();
		const consider = async (path: string): Promise<void> => {
			if (!path.endsWith(".jsonl")) return;
			const info = await stat(path).catch(() => null);
			if (info?.isFile() === true) files.set(path, info.mtimeMs);
		};
		for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
			if (entry.isFile()) {
				await consider(join(dir, entry.name));
				continue;
			}
			if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
			for (const inner of await readdir(join(dir, entry.name), { withFileTypes: true }).catch(() => [])) {
				if (inner.isFile()) await consider(join(dir, entry.name, inner.name));
			}
		}
		return files;
	}
}

function sameFiles(left: Map<string, number>, right: Map<string, number>): boolean {
	if (left.size !== right.size) return false;
	for (const [path, mtime] of left) if (right.get(path) !== mtime) return false;
	return true;
}

export const ITranscriptService = createServiceId<TranscriptService>("TranscriptService");
