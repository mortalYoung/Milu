import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { EVENTS, type Entry } from "@milu/core";

export type MemoryKind = "attribute" | "event" | "reference" | "preference" | "instruction" | "update";

export type MemoryValue = string | number | boolean;

export interface MemoryItem {
	readonly name: string;
	readonly action?: string;
	readonly amount?: number;
}

export interface MemoryRecord {
	readonly id: string;
	readonly createdAt: number;
	readonly kind: MemoryKind;
	readonly source: { readonly rawIds: readonly string[] };
	readonly summary: string;
	readonly detail?: string;
	readonly eventAt?: number;
	readonly subject?: string;
	readonly predicate?: string;
	readonly value?: MemoryValue;
	readonly direction?: "prefer" | "avoid";
	readonly scope?: string;
	readonly appliesTo?: string;
	readonly provider?: "user" | "assistant" | "external";
	readonly outcome?: "done" | "decision" | "issue";
	readonly items?: readonly MemoryItem[];
	readonly old?: MemoryValue;
	readonly next?: MemoryValue;
	readonly at?: number;
	readonly supersedes?: string;
}

export interface MemoryCheckpoint {
	readonly id: string;
	readonly createdAt: number;
	readonly kind: "checkpoint";
	readonly source: { readonly lastRawId: string };
	readonly tail?: true;
}

export type MemoryLine = MemoryRecord | MemoryCheckpoint;

export type MemoryRunStage = "memory" | "sop" | "persona";
export type MemoryRunReason = "completed" | "unfinished" | "interrupted" | "blocked" | "error";

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
	readonly throughAtomId?: string;
	readonly readEntries?: number;
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
export const watermarksFilePath = (dir: string) => join(memoryDir(dir), "watermarks.json");

export const RECALL_MAX_DETAIL_CHARS = 400;
export const RECALL_MAX_TOTAL_CHARS = 6000;

export function parseTime(text: string | undefined): number | null {
	if (!text) return null;
	const trimmed = text.trim();
	if (/^\d{10,}$/.test(trimmed)) return Number(trimmed);
	const parsed = Date.parse(trimmed);
	return Number.isNaN(parsed) ? null : parsed;
}

export function eventTime(record: MemoryRecord): number {
	return record.eventAt ?? record.createdAt;
}

export function isoDay(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

export function formatValue(value: MemoryValue | undefined): string {
	return value === undefined ? "" : String(value);
}

export function formatMemoryRecord(record: MemoryRecord, opts: { withDetail?: boolean; maxDetailChars?: number } = {}): string {
	const lines = [`# ${record.id} [${record.kind}] · ${isoDay(eventTime(record))}`, record.summary];
	if (record.kind === "update") {
		lines.push(`${formatValue(record.old)} → ${formatValue(record.next)}${record.at ? ` (${isoDay(record.at)})` : ""}`);
	}
	if (record.items?.length) {
		lines.push(record.items.map((item) => `- ${item.name}${item.action ? ` · ${item.action}` : ""}${item.amount !== undefined ? ` · ${item.amount}` : ""}`).join("\n"));
	}
	if (opts.withDetail && record.detail) {
		const detail =
			opts.maxDetailChars && record.detail.length > opts.maxDetailChars
				? `${record.detail.slice(0, opts.maxDetailChars)}… (truncated; use a narrower query for more)`
				: record.detail;
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
				if (parsed && typeof parsed.id === "string" && (parsed.kind === "checkpoint" || typeof parsed.summary === "string")) out.push(parsed);
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
		let total = 0;
		for (let index = 0; index < raw.length; index += 1) if (raw.charCodeAt(index) === 10) total += 1;
		if (raw.length > 0 && raw.charCodeAt(raw.length - 1) !== 10) total += 1;
		const runs: MemoryRunSummary[] = [];
		let end = raw.length;
		while (end > 0 && runs.length < limit) {
			const start = raw.lastIndexOf("\n", end - 1) + 1;
			const line = raw.slice(start, end).trim();
			end = start - 1;
			if (!line) continue;
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
		return { runs: runs.reverse(), total };
	} catch {
		return { runs: [], total: 0 };
	}
}

export const RECALL_MAX_MATCHES = 30;

export interface MemoryFacets {
	readonly subjects: readonly { readonly name: string; readonly count: number }[];
	readonly from?: number;
	readonly to?: number;
}

export interface QueryMemoryOptions {
	readonly query?: string;
	readonly kinds?: readonly MemoryKind[];
	readonly subject?: string;
	readonly predicate?: string;
	readonly from?: number;
	readonly to?: number;
	readonly limit?: number;
	readonly offset?: number;
	readonly includeSuperseded?: boolean;
}

export interface MemoryConflict {
	readonly subject: string;
	readonly predicate: string;
	readonly ids: readonly string[];
	readonly values: readonly MemoryValue[];
}

export interface MemoryQueryResult {
	readonly records: readonly MemoryRecord[];
	readonly matched: number;
	readonly conflicts: readonly MemoryConflict[];
	readonly facets: MemoryFacets;
}

export function tooManyMatches(result: MemoryQueryResult): string | null {
	if (result.matched <= RECALL_MAX_MATCHES) return null;
	const day = (at: number) => new Date(at).toISOString().slice(0, 10);
	const hints: string[] = [];
	if (result.facets.subjects.length > 0)
		hints.push(
			`subjects present: ${result.facets.subjects
				.slice(0, 6)
				.map((entry) => `${entry.name} (${entry.count})`)
				.join(", ")}`,
		);
	if (result.facets.from !== undefined && result.facets.to !== undefined) hints.push(`matches span ${day(result.facets.from)} … ${day(result.facets.to)} — add from/to`);
	hints.push("or page through with offset (e.g. offset=30, limit=30)");
	return `${result.matched} atoms match, which is too many to read (max ${RECALL_MAX_MATCHES}). Narrow it with a distinctive word, subject, predicate or time range — ${hints.join("; ")}.`;
}

function facetsOf(records: readonly MemoryRecord[]): MemoryFacets {
	const subjects = new Map<string, number>();
	let from = Number.POSITIVE_INFINITY;
	let to = Number.NEGATIVE_INFINITY;
	for (const record of records) {
		if (record.subject) subjects.set(record.subject, (subjects.get(record.subject) ?? 0) + 1);
		const at = eventTime(record);
		if (at < from) from = at;
		if (at > to) to = at;
	}
	const ranked = [...subjects.entries()]
		.sort((left, right) => right[1] - left[1])
		.slice(0, 8)
		.map(([name, count]) => ({ name, count }));
	return { subjects: ranked, ...(Number.isFinite(from) ? { from } : {}), ...(Number.isFinite(to) ? { to } : {}) };
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

export function activeRecords(lines: readonly MemoryLine[]): MemoryRecord[] {
	const superseded = new Set<string>();
	for (const line of lines) {
		if (line.kind === "checkpoint") continue;
		if (line.kind === "update" && line.supersedes) superseded.add(line.supersedes);
	}
	return lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint" && !superseded.has(line.id));
}

export function conflictsOf(records: readonly MemoryRecord[]): MemoryConflict[] {
	const groups = new Map<string, { subject: string; predicate: string; records: MemoryRecord[] }>();
	for (const record of records) {
		if (!record.subject || !record.predicate || record.value === undefined) continue;
		const key = `${record.subject}\u0000${record.predicate}`;
		const group = groups.get(key) ?? { subject: record.subject, predicate: record.predicate, records: [] };
		group.records.push(record);
		groups.set(key, group);
	}
	const out: MemoryConflict[] = [];
	for (const group of groups.values()) {
		const values = [...new Set(group.records.map((record) => JSON.stringify(record.value)))];
		if (values.length < 2) continue;
		out.push({
			subject: group.subject,
			predicate: group.predicate,
			ids: group.records.map((record) => record.id),
			values: group.records.map((record) => record.value as MemoryValue),
		});
	}
	return out;
}

export function queryMemory(lines: readonly MemoryLine[], opts: QueryMemoryOptions = {}): MemoryQueryResult {
	const limit = opts.limit ?? 20;
	const active = opts.includeSuperseded ? lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint") : activeRecords(lines);
	const query = opts.query?.trim();
	const hits = query ? compileQuery(query) : null;
	const matched: Array<{ record: MemoryRecord; score: number }> = [];
	for (const record of active) {
		if (opts.kinds?.length && !opts.kinds.includes(record.kind)) continue;
		if (opts.subject && record.subject?.toLowerCase() !== opts.subject.toLowerCase()) continue;
		if (opts.predicate && record.predicate?.toLowerCase() !== opts.predicate.toLowerCase()) continue;
		const at = eventTime(record);
		if (opts.from !== undefined && at < opts.from) continue;
		if (opts.to !== undefined && at > opts.to) continue;
		const score = hits === null ? 0 : hits(record.summary) * 3 + hits(record.detail ?? "");
		if (hits !== null && score === 0) continue;
		matched.push({ record, score });
	}
	if (hits !== null) matched.sort((left, right) => right.score - left.score || eventTime(right.record) - eventTime(left.record));
	else matched.sort((left, right) => eventTime(right.record) - eventTime(left.record));
	const filtered = matched.map((match) => match.record);
	const offset = Math.max(0, opts.offset ?? 0);
	return {
		records: filtered.slice(offset, offset + limit),
		matched: filtered.length,
		conflicts: conflictsOf(filtered),
		facets: facetsOf(filtered),
	};
}

export interface Watermarks {
	readonly sop?: string;
	readonly persona?: string;
}

export async function readWatermarks(dir: string): Promise<Watermarks> {
	try {
		const raw = JSON.parse(await readFile(watermarksFilePath(dir), "utf8")) as Watermarks;
		return {
			...(typeof raw.sop === "string" ? { sop: raw.sop } : {}),
			...(typeof raw.persona === "string" ? { persona: raw.persona } : {}),
		};
	} catch {
		return {};
	}
}

export async function writeWatermark(dir: string, stage: "sop" | "persona", atomId: string | undefined): Promise<void> {
	if (!atomId) return;
	if (!(await ensureMemoryDir(dir))) return;
	const current = await readWatermarks(dir);
	await writeFile(watermarksFilePath(dir), `${JSON.stringify({ ...current, [stage]: atomId }, null, "\t")}\n`, "utf8");
}

export function atomsAfter(lines: readonly MemoryLine[], watermark: string | undefined): MemoryRecord[] {
	const records = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	if (!watermark) return records;
	const at = records.findIndex((record) => record.id === watermark);
	if (at >= 0) return records.slice(at + 1);
	console.warn(`memory: watermark ${watermark} is not in memories.jsonl — replaying every atom so the stage cannot stall`);
	return records;
}

function isMemoryInternalEntry(entry: Entry): boolean {
	return (
		entry.type === "custom" &&
		(entry.customType === EVENTS.personaReminder ||
			entry.customType === EVENTS.sopReminder ||
			entry.customType === EVENTS.memoryRunStart ||
			entry.customType === EVENTS.memoryRunEnd)
	);
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

export function recentRoundFloor(entries: readonly Entry[], rounds: number): number {
	if (rounds <= 0) return 0;
	let seen = 0;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message.role !== "user") continue;
		seen += 1;
		if (seen >= rounds) return index;
	}
	return 0;
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
