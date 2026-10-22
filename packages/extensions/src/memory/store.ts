import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { EVENTS, type Entry } from "@milu/core";

export type MemoryKind = "fact" | "decision" | "issue" | "reference" | "event" | "preference" | "instruction";

export interface MemoryRelation {
	readonly type: "related" | "supersedes";
	readonly targetId: string;
}

export interface MemoryRecord {
	readonly id: string;
	readonly createdAt: number;
	readonly kind: MemoryKind;
	readonly source: { readonly rawIds: readonly string[] };
	readonly data: { readonly summary: string; readonly detail?: string };
	readonly relations?: readonly MemoryRelation[];
	readonly scene?: string;
	readonly remember?: true;
}

export interface MemoryCheckpoint {
	readonly id: string;
	readonly createdAt: number;
	readonly kind: "checkpoint";
	readonly source: { readonly lastRawId: string };
	readonly tail?: true;
}

export type MemoryLine = MemoryRecord | MemoryCheckpoint;

export type MemoryRunStage = "memory" | "scene" | "persona" | "consolidate";
export type MemoryRunReason = "completed" | "unfinished" | "interrupted" | "error";

export interface MemoryRunRecord {
	readonly runId: string;
	readonly stage: MemoryRunStage;
	readonly model: string;
	readonly startedAt: number;
	readonly endedAt: number;
	readonly durationMs: number;
	readonly reason: MemoryRunReason;
	readonly attempts: number;
	readonly added: number;
	readonly targetRawId: string | null;
	readonly cursorRawId: string | null;
	readonly throughMemoryId?: string;
	readonly throughSceneRevId?: string;
	readonly error?: string;
	readonly checkpoints?: readonly string[];
}

export interface MemoryRunLog {
	start(data: { readonly runId: string; readonly stage: MemoryRunStage; readonly startedAt: number }): Promise<void>;
	end(data: {
		readonly runId: string;
		readonly stage: MemoryRunStage;
		readonly startedAt: number;
		readonly endedAt: number;
		readonly reason: MemoryRunReason;
		readonly added: number;
	}): Promise<void>;
}

export const memoryDir = (dir: string) => join(dir, ".memory");
export const memoryFilePath = (dir: string) => join(memoryDir(dir), "memories.jsonl");
export const memoryRunsFilePath = (dir: string) => join(memoryDir(dir), "runs.jsonl");

export const RECALL_MAX_DETAIL_CHARS = 400;
export const RECALL_MAX_TOTAL_CHARS = 6000;

export function formatMemoryRecord(record: MemoryRecord, opts: { withDetail?: boolean; maxDetailChars?: number } = {}): string {
	const lines = [`# ${record.id} [${record.kind}]`, record.data.summary];
	if (opts.withDetail && record.data.detail) {
		const detail =
			opts.maxDetailChars && record.data.detail.length > opts.maxDetailChars
				? `${record.data.detail.slice(0, opts.maxDetailChars)}… (truncated; use a narrower query for more)`
				: record.data.detail;
		lines.push(detail);
	}
	return lines.join("\n");
}

export async function ensureMemoryDir(dir: string): Promise<boolean> {
	try {
		await mkdir(memoryDir(dir));
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") return true;
		if (code === "ENOENT") return false;
		throw error;
	}
}

export async function ensureMemoryFile(dir: string): Promise<void> {
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(memoryFilePath(dir), "", "utf8");
}

export async function readMemoryLines(dir: string): Promise<MemoryLine[]> {
	try {
		const raw = await readFile(memoryFilePath(dir), "utf8");
		const out: MemoryLine[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as MemoryLine;
				if (parsed && typeof parsed.id === "string" && (parsed.kind === "checkpoint" || typeof parsed.data === "object")) out.push(parsed);
			} catch {}
		}
		return out;
	} catch {
		return [];
	}
}

export async function appendMemoryLines(dir: string, lines: readonly MemoryLine[]): Promise<void> {
	if (lines.length === 0) return;
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(memoryFilePath(dir), lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
}

export async function appendMemoryRun(dir: string, record: MemoryRunRecord): Promise<void> {
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(memoryRunsFilePath(dir), `${JSON.stringify(record)}\n`, "utf8");
}

export interface MemoryRunSummary {
	readonly runId: string;
	readonly stage: MemoryRunStage;
	readonly reason: MemoryRunReason;
	readonly startedAt: number;
	readonly durationMs: number;
	readonly added: number;
	readonly error?: string;
}

export async function readMemoryRunSummaries(dir: string, limit = 5): Promise<{ runs: MemoryRunSummary[]; total: number }> {
	try {
		const raw = await readFile(memoryRunsFilePath(dir), "utf8");
		const lines = raw.split("\n").filter((line) => line.trim() !== "");
		const runs: MemoryRunSummary[] = [];
		for (const line of lines) {
			try {
				const record = JSON.parse(line) as MemoryRunRecord;
				runs.push({
					runId: record.runId,
					stage: record.stage,
					reason: record.reason,
					startedAt: record.startedAt,
					durationMs: record.durationMs,
					added: record.added,
					...(record.error ? { error: record.error } : {}),
				});
			} catch {}
		}
		return { runs: runs.slice(-limit), total: runs.length };
	} catch {
		return { runs: [], total: 0 };
	}
}

export interface QueryMemoryOptions {
	readonly query?: string;
	readonly kinds?: readonly MemoryKind[];
	readonly limit?: number;
	readonly includeSuperseded?: boolean;
}

const QUERY_SEPARATORS = /[\s|,，、;；/／｜]+/;

function countOccurrences(text: string, lowerNeedle: string): number {
	const lower = text.toLowerCase();
	let count = 0;
	let from = 0;
	for (;;) {
		const at = lower.indexOf(lowerNeedle, from);
		if (at < 0) return count;
		count += 1;
		from = at + lowerNeedle.length;
	}
}

function safeRegex(source: string, flags = "i"): RegExp | null {
	try {
		return new RegExp(source, flags);
	} catch {
		return null;
	}
}

function compileQuery(query: string): (text: string) => number {
	const terms = query
		.split(QUERY_SEPARATORS)
		.filter((term) => term !== "")
		.map((term) => term.toLowerCase());
	const phrase = safeRegex(query, "gi");
	return (text) => {
		let hits = 0;
		for (const term of terms) hits += countOccurrences(text, term);
		if (phrase !== null) hits += (text.match(phrase) ?? []).filter((hit) => hit !== "").length;
		return hits;
	};
}

export function queryMemory(lines: readonly MemoryLine[], opts: QueryMemoryOptions = {}): MemoryRecord[] {
	const limit = opts.limit ?? 20;
	const superseded = new Set<string>();
	if (!opts.includeSuperseded) {
		for (const line of lines) {
			if (line.kind === "checkpoint") continue;
			for (const relation of line.relations ?? []) {
				if (relation.type === "supersedes") superseded.add(relation.targetId);
			}
		}
	}
	const query = opts.query?.trim();
	const hits = query ? compileQuery(query) : null;
	const matched: Array<{ record: MemoryRecord; score: number }> = [];
	for (const line of lines) {
		if (line.kind === "checkpoint") continue;
		if (!opts.includeSuperseded && superseded.has(line.id)) continue;
		if (opts.kinds?.length && !opts.kinds.includes(line.kind)) continue;
		const score = hits === null ? 0 : hits(line.data.summary) * 3 + hits(line.data.detail ?? "");
		if (hits !== null && score === 0) continue;
		matched.push({ record: line, score });
	}
	if (hits !== null) matched.sort((left, right) => right.score - left.score || right.record.createdAt - left.record.createdAt);
	else matched.sort((left, right) => right.record.createdAt - left.record.createdAt);
	return matched.slice(0, limit).map((match) => match.record);
}

function isMemoryInternalEntry(entry: Entry): boolean {
	return entry.type === "custom" && (entry.customType === EVENTS.memoryContext || entry.customType === EVENTS.memoryRunStart || entry.customType === EVENTS.memoryRunEnd);
}

function prepareEntries(entries: readonly Entry[]): Entry[] {
	const rewoundIds = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== EVENTS.rewind) continue;
		const data = entry.data as { targetId?: unknown; shadowedIds?: unknown } | undefined;
		if (typeof data?.targetId === "string") rewoundIds.add(data.targetId);
		if (Array.isArray(data?.shadowedIds)) for (const id of data.shadowedIds) if (typeof id === "string") rewoundIds.add(id);
	}
	return entries.filter((entry) => !isMemoryInternalEntry(entry) && !rewoundIds.has(entry.id));
}

function isExtractableEntry(entry: Entry): boolean {
	if (entry.type === "message") return entry.message.role === "user" || entry.message.role === "assistant";
	return entry.type === "custom" && entry.customType === EVENTS.sendMessage;
}

export function extractionEntries(entries: readonly Entry[]): Entry[] {
	return prepareEntries(entries).filter(isExtractableEntry);
}

export function entryIndexById(entries: readonly Entry[]): Map<string, number> {
	return new Map(entries.map((entry, index) => [entry.id, index]));
}

export function latestCheckpointIndex(lines: readonly MemoryLine[], indexById: Map<string, number>): number {
	let best = -1;
	for (const line of lines) {
		if (line.kind !== "checkpoint") continue;
		const index = indexById.get(line.source.lastRawId);
		if (index !== undefined && index > best) best = index;
	}
	return best;
}

export function recordProgressIndex(records: readonly MemoryRecord[], indexById: Map<string, number>): number {
	let best = -1;
	for (const record of records) {
		for (const rawId of record.source.rawIds) {
			const index = indexById.get(rawId);
			if (index !== undefined && index > best) best = index;
		}
	}
	return best;
}

export function makeCheckpoint(lastRawId: string, tail = false): MemoryCheckpoint {
	return { id: `chk-${randomUUID()}`, createdAt: Date.now(), kind: "checkpoint", source: { lastRawId }, ...(tail ? { tail: true as const } : {}) };
}

export function lastCheckpoint(lines: readonly MemoryLine[]): MemoryCheckpoint | null {
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (line?.kind === "checkpoint") return line;
	}
	return null;
}

export function checkpointCoversSession(checkpoints: readonly MemoryCheckpoint[], entries: readonly Entry[]): boolean {
	const last = extractionEntries(entries).at(-1);
	return last !== undefined && checkpoints.some((checkpoint) => checkpoint.tail === true && checkpoint.source.lastRawId === last.id);
}

export interface MemoryPendingStatus {
	readonly pending: boolean;
	readonly rounds: number;
}

export async function memoryPendingStatus(dir: string, entries: readonly Entry[]): Promise<MemoryPendingStatus> {
	const prepared = extractionEntries(entries);
	if (prepared.length === 0) return { pending: false, rounds: 0 };
	const lines = await readMemoryLines(dir);
	const indexById = entryIndexById(prepared);
	const records = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	const cursor = Math.max(latestCheckpointIndex(lines, indexById), recordProgressIndex(records, indexById));
	let rounds = 0;
	for (let index = Math.max(0, cursor + 1); index < prepared.length; index += 1) {
		const entry = prepared[index];
		if (entry?.type === "message" && entry.message.role === "user") rounds += 1;
	}
	return { pending: cursor < prepared.length - 1, rounds };
}
