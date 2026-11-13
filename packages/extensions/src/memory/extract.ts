import { randomUUID } from "node:crypto";

import { type AgentTool, type Entry, type Model, projectSlice, type Static, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
import { startDeadline } from "./deadline.ts";
import { runRalphLoop } from "./loop.ts";
import {
	activeRecords,
	appendMemoryLines,
	appendMemoryRun,
	ensureMemoryFile,
	extractionEntries,
	entryIndexById,
	latestCheckpointIndex,
	makeCheckpoint,
	type MemoryKind,
	type MemoryQueryResult,
	type QueryMemoryOptions,
	parseTime,
	type MemoryRecord,
	type MemoryRunLog,
	type MemoryRunReason,
	type MemoryValue,
	queryMemory,
	readMemoryLines,
	recentRoundFloor,
	recordProgressIndex,
	tooManyMatches,
} from "./store.ts";

const MEMORY_WORKFLOW = `You are running a memory extraction loop for this partner.

Workflow:
1. read_raw shows raw conversation entries; each line starts with the entry id and its timestamp.
2. Call memory op "read" when you need to know what is already stored (structured filters: subject / predicate / kinds).
3. Write every durable atom with memory op "write".
   - rawIds must be ids you actually read.
   - event / update need eventAt (or at) taken from the source entry timestamp, never "now".
4. Stop once every atom you found is written; the engine runs another pass while anything is left uncovered.

Kinds (6):
- attribute: stable, no occurrence time, written as subject + predicate + value (e.g. degree, commute minutes, model of a device).
- event: something that happened at a time and can repeat or be counted. Carries eventAt; items[] for enumerable things (each counted thing is one item); value for a number; outcome only when the episode ended as a decision or an issue.
- reference: a list, address, parameter or plan given by the assistant or an external source. provider is user / assistant / external.
- preference: "I prefer / I avoid", with direction and scope (the situation it applies to).
- instruction: a long-term requirement the user sets for your behaviour. appliesTo names the scope ("milu-repo", "global").
- update: a new value for an existing subject + predicate. Carries old, next, at and supersedes (the id of the record it replaces).

Boundary rules (REQUIRED):
- One fact never becomes two kinds. If it is stable and timeless it is an attribute, not an event.
- A user question is not an event by itself; only an episode with something that can be counted or timed is.
- When a new value replaces an old one, write update (not event) and point supersedes at the old record.
- Do not write task checklists, narration, or one-off requests as atoms.
- Read before writing: if an atom already exists, skip it. Writing the same statement twice is rejected.
- reference is only for something the user asked for and will reuse. Never store generic assistant advice or recommendation lists.`;

const memoryKindSchema = Type.Union([
	Type.Literal("attribute"),
	Type.Literal("event"),
	Type.Literal("reference"),
	Type.Literal("preference"),
	Type.Literal("instruction"),
	Type.Literal("update"),
]);

const memoryQueryFields = {
	query: Type.Optional(Type.String({ description: "read: keywords matched against summary/detail, split on spaces, `|`, `,`, `/`; the whole query is also matched as a regex" })),
	kinds: Type.Optional(Type.Array(memoryKindSchema, { description: "read: only return these kinds" })),
	subject: Type.Optional(Type.String({ description: "read: exact subject filter (case-insensitive)" })),
	predicate: Type.Optional(Type.String({ description: "read: exact predicate filter (case-insensitive)" })),
	from: Type.Optional(Type.String({ description: "read: earliest event time, ISO date or timestamp" })),
	to: Type.Optional(Type.String({ description: "read: latest event time, ISO date or timestamp" })),
	limit: Type.Optional(Type.Integer({ description: "read: maximum records to return (default 20)" })),
	offset: Type.Optional(Type.Integer({ description: "read: skip this many records after ranking (use it to page through a large result)" })),
	includeSuperseded: Type.Optional(Type.Boolean({ description: "read: include records replaced by an update (default false)" })),
};

const timeField = (description: string) => Type.Optional(Type.String({ description }));

const memoryItemSchema = Type.Object({
	name: Type.String({ description: "what the item is, e.g. a venue or a device" }),
	action: Type.Optional(Type.String({ description: "what happened to it (exchange, buy, visit, …)" })),
	amount: Type.Optional(Type.Number({ description: "counted amount for this item" })),
});

const atomicValue = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);

export const memorySchema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("write")], {
		description: "read: search this partner's atoms; write: append one atom",
	}),
	...memoryQueryFields,
	kind: Type.Optional(memoryKindSchema),
	summary: Type.Optional(Type.String({ description: "write: one-line statement of the atom, in the same language as the source entries — never translate" })),
	detail: Type.Optional(Type.String({ description: "write: optional supporting detail" })),
	rawIds: Type.Optional(Type.Array(Type.String({ description: "write: raw entry ids this atom came from (must be read first)" }))),
	eventAt: timeField("write: when the event happened, taken from the source entry timestamp"),
	at: timeField("write: update only — when the value changed"),
	subject: Type.Optional(Type.String({ description: "write: attribute / preference / update — who or what the atom is about" })),
	predicate: Type.Optional(Type.String({ description: "write: attribute / update — the property, e.g. degree, commute_minutes" })),
	value: Type.Optional(atomicValue),
	old: Type.Optional(atomicValue),
	next: Type.Optional(atomicValue),
	direction: Type.Optional(Type.Union([Type.Literal("prefer"), Type.Literal("avoid")])),
	scope: Type.Optional(Type.String({ description: "write: preference — the situation the preference applies to" })),
	appliesTo: Type.Optional(Type.String({ description: 'write: instruction — the scope of the rule, e.g. "milu-repo" or "global"' })),
	provider: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("assistant"), Type.Literal("external")])),
	outcome: Type.Optional(Type.Union([Type.Literal("done"), Type.Literal("decision"), Type.Literal("issue")])),
	items: Type.Optional(Type.Array(memoryItemSchema, { description: "write: event — enumerable things this event produced, one item each" })),
	supersedes: Type.Optional(Type.String({ description: "write: update — the id of the record this value replaces" })),
});

export const memoryQuerySchema = Type.Object({
	op: Type.Optional(Type.Literal("read")),
	...memoryQueryFields,
});

type MemoryToolParams = Static<typeof memorySchema> | Static<typeof memoryQuerySchema>;

function isWriteCall(params: MemoryToolParams): params is Static<typeof memorySchema> {
	return "op" in params && params.op === "write";
}

const MAX_READ_ENTRIES = 60;

const readRawSchema = Type.Object({
	from: Type.String({ description: "Start reading from this raw id (inclusive); always pass the starting id from the prompt" }),
	limit: Type.Optional(Type.Integer({ description: `Maximum entries to return (default 50, at most ${MAX_READ_ENTRIES})` })),
});

export function shingles(text: string): Set<string> {
	const normalized = text
		.toLowerCase()
		.replace(/[\p{P}\p{S}\s]+/gu, " ")
		.trim();
	const out = new Set<string>();
	for (let index = 0; index + 3 <= normalized.length; index += 1) out.add(normalized.slice(index, index + 3));
	return out;
}

export function jaccard(left: Set<string>, right: Set<string>): number {
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	const [small, large] = left.size <= right.size ? [left, right] : [right, left];
	for (const item of small) if (large.has(item)) shared += 1;
	return shared / (left.size + right.size - shared);
}

const NEAR_DUPLICATE = 0.8;

function normalizedSummary(summary: string): string {
	return summary.replace(/\s+/g, " ").trim().toLowerCase();
}

function dedupeKey(record: { kind: MemoryKind; summary: string; subject?: string; predicate?: string; value?: MemoryValue }): string {
	if (record.subject && record.predicate && record.value !== undefined) {
		return `${record.kind}|${record.subject.toLowerCase()}|${record.predicate.toLowerCase()}|${JSON.stringify(record.value)}`;
	}
	return `${record.kind}|${normalizedSummary(record.summary)}`;
}

interface WriteDeps {
	readonly dir: string;
	readonly entries: readonly Entry[];
	readonly seen: Set<string>;
	readonly similar: { readonly kind: MemoryKind; readonly set: Set<string> }[];
	readonly indexById: Map<string, number>;
	readonly readProgress: { index: number };
	readonly activeById: Map<string, MemoryRecord>;
	readonly records: MemoryRecord[];
	readonly onAdded: () => void;
}

interface MemoryToolOptions {
	readonly read?: (opts: QueryMemoryOptions) => Promise<MemoryQueryResult>;
	readonly write?: WriteDeps;
	readonly description?: string;
}

export function entryText(entry: Entry): string {
	const slice = projectSlice([entry])[0] ?? null;
	const message = slice as { role?: unknown; content?: unknown } | null;
	if (!message) return JSON.stringify(entry);
	return typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
}

function cjkRatio(text: string): number {
	let han = 0;
	let letters = 0;
	for (const char of text) {
		if (!/\p{L}/u.test(char)) continue;
		letters += 1;
		if (/\p{Script=Han}/u.test(char)) han += 1;
	}
	return letters === 0 ? 0 : han / letters;
}

export function languageProblem(summary: string, sources: readonly Entry[]): string | null {
	if (sources.length === 0) return null;
	const source = cjkRatio(sources.map(entryText).join(" "));
	const atom = cjkRatio(summary);
	if (source >= 0.3 && atom <= 0.05) return "summary must stay in the source language (Chinese here) — do not translate the conversation";
	if (source <= 0.05 && atom >= 0.2) return "summary must stay in the source language (English here) — do not translate the conversation";
	return null;
}

function entryStamp(entry: Entry): string {
	const timestamp = (entry as { timestamp?: unknown }).timestamp;
	return typeof timestamp === "number" ? new Date(timestamp).toISOString() : "";
}

function createReadRawTool(
	entries: readonly Entry[],
	indexById: Map<string, number>,
	progress: { index: number; read: number },
): AgentTool<typeof readRawSchema, { ok: boolean; error?: string }> {
	return {
		name: "read_raw",
		label: "Read Raw",
		description: "Read raw conversation entries from a starting raw id (inclusive). Always pass the starting id given in the prompt and keep moving forward.",
		parameters: readRawSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const startIndex = indexById.get(params.from);
			if (startIndex === undefined) {
				return {
					content: [{ type: "text", text: `Unknown raw id "${params.from}". Start from the id provided in the prompt.` }],
					details: { ok: false, error: "unknown from raw id" },
				};
			}
			const requested = Math.max(1, params.limit ?? 50);
			const limit = Math.min(requested, MAX_READ_ENTRIES);
			const selected = entries.slice(startIndex, startIndex + limit);
			progress.read += selected.length;
			const last = selected.at(-1);
			if (last) {
				const lastIndex = indexById.get(last.id);
				if (lastIndex !== undefined) progress.index = Math.max(progress.index, lastIndex);
			}
			const capped = requested > MAX_READ_ENTRIES;
			const body = selected
				.map((entry) => {
					const slice = projectSlice([entry])[0] ?? null;
					const message = slice as { role?: unknown; content?: unknown } | null;
					const content = message ? (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")) : JSON.stringify(entry);
					const stamp = entryStamp(entry);
					return `[${entry.id}]${stamp ? ` ${stamp}` : ""} ${message ? String(message.role ?? "") : entry.type}: ${content}`;
				})
				.join("\n\n");
			const next = selected.at(-1);
			const note = capped
				? `\n\n(returned ${selected.length} of ${requested} requested entries — read at most ${MAX_READ_ENTRIES} at a time; continue from ${next?.id ?? "the next id"})`
				: "";
			return { content: [{ type: "text", text: body + note }], details: { ok: true } };
		},
	};
}

function kindProblem(params: Static<typeof memorySchema>): string | null {
	const kind = params.kind as MemoryKind | undefined;
	const need = (ok: boolean, field: string): string | null => (ok ? null : `${kind} needs ${field}`);
	if (!kind) return "write needs kind";
	if (kind === "attribute") return need(Boolean(params.subject && params.predicate && params.value !== undefined), "subject, predicate and value");
	if (kind === "event") {
		if (!params.eventAt) return "event needs eventAt (the source entry timestamp)";
		return need(Boolean(params.items?.length || params.value !== undefined), "items[] or a numeric value");
	}
	if (kind === "preference") return need(Boolean(params.direction && params.scope), "direction and scope");
	if (kind === "reference") return need(Boolean(params.provider), "provider (user / assistant / external)");
	if (kind === "instruction") return need(Boolean(params.appliesTo), "appliesTo (the scope of the rule)");
	if (kind === "update") {
		if (!params.subject || !params.predicate) return "update needs subject and predicate";
		if (params.old === undefined || params.next === undefined) return "update needs old and next";
		if (!params.at) return "update needs at (when the value changed)";
		return need(Boolean(params.supersedes), "supersedes (the id of the record being replaced)");
	}
	return null;
}

function createMemoryTool(opts: MemoryToolOptions): AgentTool<typeof memorySchema | typeof memoryQuerySchema, { ok: boolean; error?: string }> {
	const canWrite = opts.write !== undefined;
	return {
		name: "memory",
		label: "Memory",
		description:
			opts.description ??
			"Read this partner's atoms. Matches are ranked by relevance when a query is given, otherwise newest first (event time); records replaced by an update are hidden unless includeSuperseded is true. Conflicts (same subject+predicate with several values) are reported.",
		parameters: canWrite ? memorySchema : memoryQuerySchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `memory rejected: ${message}` }], details: { ok: false, error: message } });
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });

			if (!isWriteCall(params)) {
				if (!opts.read) return reject("read is not available");
				const from = parseTime(params.from);
				const to = parseTime(params.to);
				if (params.from && from === null) return reject(`from "${params.from}" is not a date`);
				if (params.to && to === null) return reject(`to "${params.to}" is not a date`);
				const page = await opts.read({
					query: params.query,
					kinds: params.kinds as readonly MemoryKind[] | undefined,
					subject: params.subject,
					predicate: params.predicate,
					...(from !== null ? { from } : {}),
					...(to !== null ? { to } : {}),
					limit: params.limit,
					offset: params.offset,
					includeSuperseded: params.includeSuperseded,
				});
				const memories = page.records;
				const tooMany = tooManyMatches(page);
				if (tooMany && (params.offset ?? 0) === 0) return reject(tooMany);
				if (memories.length === 0) return note("No atoms found.");
				return note(memories.map((memory) => format(memory)).join("\n\n"));
			}

			const write = opts.write;
			if (!write) return reject("write is not available");
			const problem = kindProblem(params);
			if (problem) return reject(problem);
			const summary = (params.summary ?? "").trim();
			if (!summary) return reject("write needs summary");
			const rawIds = (params.rawIds ?? []).filter((id) => {
				const index = write.indexById.get(id);
				return index !== undefined && index <= write.readProgress.index;
			});
			if (rawIds.length === 0) return reject("rawIds must reference raw conversation entries you have already read");
			const sources = rawIds.map((id) => write.entries[write.indexById.get(id)!]).filter((entry): entry is Entry => entry !== undefined);
			const language = languageProblem(summary, sources);
			if (language) return reject(language);
			const key = dedupeKey({
				kind: params.kind as MemoryKind,
				summary,
				...(params.subject ? { subject: params.subject } : {}),
				...(params.predicate ? { predicate: params.predicate } : {}),
				...(params.value !== undefined ? { value: params.value as MemoryValue } : {}),
			});
			if (write.seen.has(key)) return reject("this atom already exists — skip it instead of writing it again");
			const candidate = shingles(summary);
			const twin = write.similar.find((other) => other.kind === params.kind && jaccard(candidate, other.set) >= NEAR_DUPLICATE);
			if (twin) return reject("this is a near-duplicate of an atom already stored — skip it, or fold the new detail into the existing one");
			const eventAt = parseTime(params.eventAt);
			if (params.eventAt && eventAt === null) return reject(`eventAt "${params.eventAt}" is not a date`);
			const at = parseTime(params.at);
			if (params.at && at === null) return reject(`at "${params.at}" is not a date`);
			if (params.kind === "update") {
				const targetId = params.supersedes ?? "";
				if (!write.activeById.has(targetId)) return reject(`supersedes "${targetId}" is not an active atom — call memory op "read" to find the current one`);
			}
			const record: MemoryRecord = {
				id: `mem-${randomUUID()}`,
				createdAt: Date.now(),
				kind: params.kind as MemoryKind,
				source: { rawIds },
				summary,
				...(params.detail ? { detail: params.detail } : {}),
				...(eventAt !== null ? { eventAt } : {}),
				...(at !== null ? { at } : {}),
				...(params.subject ? { subject: params.subject } : {}),
				...(params.predicate ? { predicate: params.predicate } : {}),
				...(params.value !== undefined ? { value: params.value as MemoryValue } : {}),
				...(params.old !== undefined ? { old: params.old as MemoryValue } : {}),
				...(params.next !== undefined ? { next: params.next as MemoryValue } : {}),
				...(params.direction ? { direction: params.direction } : {}),
				...(params.scope ? { scope: params.scope } : {}),
				...(params.appliesTo ? { appliesTo: params.appliesTo } : {}),
				...(params.provider ? { provider: params.provider } : {}),
				...(params.outcome ? { outcome: params.outcome } : {}),
				...(params.items?.length ? { items: params.items } : {}),
				...(params.supersedes ? { supersedes: params.supersedes } : {}),
			};
			await appendMemoryLines(write.dir, [record]);
			write.records.push(record);
			write.seen.add(key);
			write.similar.push({ kind: record.kind, set: candidate });
			write.activeById.set(record.id, record);
			if (record.kind === "update" && record.supersedes) write.activeById.delete(record.supersedes);
			write.onAdded();
			return note(`memory ${record.id} written`);
		},
	};
}

function format(record: MemoryRecord): string {
	const lines = [`# ${record.id} [${record.kind}] · ${new Date(record.eventAt ?? record.createdAt).toISOString().slice(0, 10)}`, record.summary];
	if (record.kind === "update") lines.push(`${String(record.old ?? "")} → ${String(record.next ?? "")}`);
	if (record.detail) lines.push(record.detail.length > 400 ? `${record.detail.slice(0, 400)}…` : record.detail);
	return lines.join("\n");
}

export interface OrganizeMemoryOptions {
	readonly dir: string;
	readonly entries: readonly Entry[];
	readonly model: Model<any>;
	readonly streamFn: StreamFn;
	readonly recentRounds?: number;
	readonly signal?: AbortSignal;
	readonly logRun?: MemoryRunLog;
}

const MAX_ORGANIZE_ATTEMPTS = 5;
const STAGE_TIMEOUT_MS = 8 * 60_000;

export async function organizeMemory(opts: OrganizeMemoryOptions): Promise<number> {
	await ensureMemoryFile(opts.dir);
	const entries = extractionEntries(opts.entries);
	if (entries.length === 0) return 0;

	const lines = await readMemoryLines(opts.dir);
	const records = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	const indexById = entryIndexById(entries);
	const targetRawId = entries.at(-1)!.id;
	const targetIndex = indexById.get(targetRawId) ?? entries.length - 1;
	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	const checkpoints: string[] = [];
	let attempts = 0;
	let added = 0;

	const existingCursor = latestCheckpointIndex(lines, indexById);
	const recovered = recordProgressIndex(records, indexById);
	let cursorIndex = Math.max(existingCursor, recovered);
	if (cursorIndex < 0 && opts.recentRounds !== undefined) {
		const floor = recentRoundFloor(entries, opts.recentRounds);
		if (floor > 0) {
			const rawId = entries[floor - 1]!.id;
			await appendMemoryLines(opts.dir, [makeCheckpoint(rawId)]);
			checkpoints.push(rawId);
			cursorIndex = floor - 1;
		}
	}
	if (recovered > existingCursor) {
		const rawId = entries[recovered]!.id;
		await appendMemoryLines(opts.dir, [makeCheckpoint(rawId, recovered >= targetIndex)]);
		checkpoints.push(rawId);
	}
	if (cursorIndex >= targetIndex) return added;

	if (opts.logRun) {
		try {
			await opts.logRun.start({ runId, stage: "memory", startedAt });
		} catch (error) {
			console.error("memory run start log failed:", error);
		}
	}

	async function logEnd(reason: MemoryRunReason, endedAt: number): Promise<void> {
		try {
			await opts.logRun?.end({ runId, stage: "memory", startedAt, endedAt, reason, added });
		} catch (error) {
			console.error("memory run end log failed:", error);
		}
	}

	let passRead = { index: -1, read: 0 };
	let readEntries = 0;
	const deadline = startDeadline(opts.signal, STAGE_TIMEOUT_MS);
	try {
		const outcome = await runRalphLoop({
			maxAttempts: MAX_ORGANIZE_ATTEMPTS,
			signal: deadline.signal,
			createPass: () => {
				passRead = { index: -1, read: 0 };
				const startIndex = Math.max(0, cursorIndex + 1);
				const seen = new Set(records.map((record) => dedupeKey(record)));
				const similar = records.map((record) => ({ kind: record.kind, set: shingles(record.summary) }));
				const activeById = new Map(activeRecords(records).map((record) => [record.id, record]));
				const agent = createMemoryAgent(opts.model, opts.streamFn, MEMORY_WORKFLOW, [
					createReadRawTool(entries, indexById, passRead),
					createMemoryTool({
						read: async (query) => queryMemory(await readMemoryLines(opts.dir), query),
						write: {
							dir: opts.dir,
							entries,
							seen,
							similar,
							indexById,
							readProgress: passRead,
							activeById,
							records,
							onAdded: () => {
								added += 1;
							},
						},
					}),
				]);
				return { agent, prompt: `There are still some logs waiting to be extracted. Please read from ${entries[startIndex]!.id}. The last raw id to cover is ${targetRawId}.` };
			},
			settlePass: async () => {
				readEntries += passRead.read;
				const reached = Math.min(targetIndex, Math.max(passRead.index, recordProgressIndex(records, indexById)));
				if (reached <= cursorIndex) return "stalled";
				cursorIndex = reached;
				const rawId = entries[cursorIndex]!.id;
				await appendMemoryLines(opts.dir, [makeCheckpoint(rawId, cursorIndex >= targetIndex)]);
				checkpoints.push(rawId);
				return cursorIndex >= targetIndex ? "done" : "advanced";
			},
		});
		attempts = outcome.attempts;
		const endedAt = Date.now();
		await logEnd(deadline.timedOut() ? "blocked" : outcome.reason, endedAt);
		await appendMemoryRun(opts.dir, {
			runId,
			stage: "memory",
			model: `${opts.model.provider}/${opts.model.id ?? "default"}`,
			startedAt,
			endedAt,
			durationMs: endedAt - startedAt,
			reason: deadline.timedOut() ? "blocked" : outcome.reason,
			attempts,
			added,
			targetRawId,
			cursorRawId: cursorIndex >= 0 ? entries[cursorIndex]!.id : null,
			readEntries,
			...(checkpoints.length ? { checkpoints } : {}),
		});
		return added;
	} catch (error) {
		const endedAt = Date.now();
		await logEnd("error", endedAt);
		await appendMemoryRun(opts.dir, {
			runId,
			stage: "memory",
			model: `${opts.model.provider}/${opts.model.id ?? "default"}`,
			startedAt,
			endedAt,
			durationMs: endedAt - startedAt,
			reason: "error",
			attempts,
			added,
			targetRawId,
			cursorRawId: cursorIndex >= 0 ? entries[cursorIndex]!.id : null,
			error: error instanceof Error ? error.message : String(error),
			...(checkpoints.length ? { checkpoints } : {}),
		});
		throw error;
	} finally {
		deadline.cancel();
	}
}
