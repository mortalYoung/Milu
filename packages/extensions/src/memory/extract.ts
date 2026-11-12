import { randomUUID } from "node:crypto";

import { type AgentTool, type Entry, type Model, projectSlice, type Static, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
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
- Do not write task checklists, narration, or one-off requests as atoms.`;

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
	summary: Type.Optional(Type.String({ description: "write: one-line statement of the atom (Chinese if the source is Chinese)" })),
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

const readRawSchema = Type.Object({
	from: Type.String({ description: "Start reading from this raw id (inclusive); always pass the starting id from the prompt" }),
	limit: Type.Optional(Type.Integer({ description: "Maximum entries to return (default 50)" })),
});

interface WriteDeps {
	readonly dir: string;
	readonly indexById: Map<string, number>;
	readonly readProgress: { index: number };
	readonly activeById: Map<string, MemoryRecord>;
	readonly records: MemoryRecord[];
	readonly onAdded: () => void;
}

interface MemoryToolOptions {
	readonly read?: (opts: QueryMemoryOptions) => Promise<readonly MemoryRecord[]>;
	readonly write?: WriteDeps;
	readonly description?: string;
}

function entryStamp(entry: Entry): string {
	const timestamp = (entry as { timestamp?: unknown }).timestamp;
	return typeof timestamp === "number" ? new Date(timestamp).toISOString() : "";
}

function createReadRawTool(
	entries: readonly Entry[],
	indexById: Map<string, number>,
	progress: { index: number },
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
			const limit = Math.max(1, params.limit ?? 50);
			const selected = entries.slice(startIndex, startIndex + limit);
			const last = selected.at(-1);
			if (last) {
				const lastIndex = indexById.get(last.id);
				if (lastIndex !== undefined) progress.index = Math.max(progress.index, lastIndex);
			}
			const body = selected
				.map((entry) => {
					const slice = projectSlice([entry])[0] ?? null;
					const message = slice as { role?: unknown; content?: unknown } | null;
					const content = message ? (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")) : JSON.stringify(entry);
					const stamp = entryStamp(entry);
					return `[${entry.id}]${stamp ? ` ${stamp}` : ""} ${message ? String(message.role ?? "") : entry.type}: ${content}`;
				})
				.join("\n\n");
			return { content: [{ type: "text", text: body }], details: { ok: true } };
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
				const memories = await opts.read({
					query: params.query,
					kinds: params.kinds as readonly MemoryKind[] | undefined,
					subject: params.subject,
					predicate: params.predicate,
					...(from !== null ? { from } : {}),
					...(to !== null ? { to } : {}),
					limit: params.limit,
					includeSuperseded: params.includeSuperseded,
				});
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

	let passRead = { index: -1 };
	try {
		const outcome = await runRalphLoop({
			maxAttempts: MAX_ORGANIZE_ATTEMPTS,
			signal: opts.signal,
			createPass: () => {
				passRead = { index: -1 };
				const startIndex = Math.max(0, cursorIndex + 1);
				const activeById = new Map(activeRecords(records).map((record) => [record.id, record]));
				const agent = createMemoryAgent(opts.model, opts.streamFn, MEMORY_WORKFLOW, [
					createReadRawTool(entries, indexById, passRead),
					createMemoryTool({
						read: async (query) => queryMemory(await readMemoryLines(opts.dir), query).records,
						write: {
							dir: opts.dir,
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
		await logEnd(outcome.reason, endedAt);
		await appendMemoryRun(opts.dir, {
			runId,
			stage: "memory",
			model: `${opts.model.provider}/${opts.model.id ?? "default"}`,
			startedAt,
			endedAt,
			durationMs: endedAt - startedAt,
			reason: outcome.reason,
			attempts,
			added,
			targetRawId,
			cursorRawId: cursorIndex >= 0 ? entries[cursorIndex]!.id : null,
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
	}
}
