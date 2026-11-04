import { randomUUID } from "node:crypto";

import { type AgentTool, type Entry, type Model, projectSlice, type Static, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
import { runRalphLoop } from "./loop.ts";
import {
	appendMemoryLines,
	appendMemoryRun,
	ensureMemoryFile,
	extractionEntries,
	entryIndexById,
	type MemoryRecord,
	type MemoryRunLog,
	type MemoryRunReason,
	type QueryMemoryOptions,
	makeCheckpoint,
	latestCheckpointIndex,
	queryMemory,
	readMemoryLines,
	recordProgressIndex,
} from "./store.ts";

const MEMORY_WORKFLOW = `You are running a memory extraction loop for this partner.

Workflow:
1. The user tells you where to start reading raw conversation entries and which raw id must be covered.
2. Call read_raw to inspect raw entries. Keep reading forward until you have seen the latest raw entries.
3. When you need context about existing memories, call memory with op "read".
4. For each durable memory or objective user event, call memory with op "write" (kind, summary, detail, rawIds and optional relations).
   - rawIds must be chosen from the raw ids you actually read.
   - Use relation type "related" when the new memory connects to an existing memory.
   - Use relation type "supersedes" when the new memory replaces an existing memory.
5. Stop once you have read through the target raw id and written every durable memory or event you found; the engine runs another pass while anything is left uncovered.

Allowed memory kinds: fact, decision, issue, reference, event, preference, instruction.
Do NOT extract task checklists or one-off instructions.

Kind guidance (REQUIRED):
- fact: stable technical or project facts.
- decision: a chosen approach and its rationale.
- issue: a problem encountered and its fix.
- reference: paths, commands, or key locations worth remembering.
- preference: a durable user preference, habit, or way of working ("User prefers X over Y"). Only when the user states it explicitly or it is consistently evidenced; never infer from a single choice.
- instruction: a long-term behavior rule the user sets for you ("reply in Chinese", "never auto-commit"). One-off requests are not instructions.
- event: an objective user-driven episode. State only what happened — never infer preferences, motives, or conventions.

Event guidance (REQUIRED):
- Write an event for every substantive user question, request, or instruction you find. Do not require it to be a reusable fact or future-relevant; events are objective history.
- Examples of event summaries: "User asked what the current time was.", "User requested a random table.", "User asked what a TOON code fence is."
- Merge multi-turn messages that are all about the same intent into ONE event and list all their raw ids. Start a new event when the user's intent changes.
- Prefer merging over splitting: when consecutive messages belong to the same larger effort, keep them in one event even if they contain several related sub-questions; split only when the user clearly switches topic.

Field guidance:
- scene: optional short theme name for grouping related memories across sessions (e.g. "auth refactor", "release process"). Reuse the same name for the same theme.
- remember: set true only when the user explicitly asks you to remember something long-term.`;

const memoryKindSchema = Type.Union([
	Type.Literal("fact"),
	Type.Literal("decision"),
	Type.Literal("issue"),
	Type.Literal("reference"),
	Type.Literal("event"),
	Type.Literal("preference"),
	Type.Literal("instruction"),
]);

const memoryQueryFields = {
	query: Type.Optional(Type.String({ description: "read: keywords matched against memory text, split on spaces, `|`, `,`, `/`; the whole query is also matched as a regex" })),
	kinds: Type.Optional(Type.Array(memoryKindSchema, { description: "read: only return these kinds" })),
	limit: Type.Optional(Type.Integer({ description: "read: maximum memories to return (default 20)" })),
	includeSuperseded: Type.Optional(Type.Boolean({ description: "read: include memories that have been superseded (default false)" })),
};

export const memorySchema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("write")], {
		description: "read: search this partner's durable memories; write: append one new durable memory record",
	}),
	...memoryQueryFields,
	kind: Type.Optional(memoryKindSchema),
	summary: Type.Optional(Type.String({ description: "write: short durable memory statement" })),
	detail: Type.Optional(Type.String({ description: "write: optional supporting detail" })),
	rawIds: Type.Optional(Type.Array(Type.String({ description: "write: origin raw entry ids this memory came from" }))),
	relations: Type.Optional(
		Type.Array(
			Type.Object({
				type: Type.Union([Type.Literal("related"), Type.Literal("supersedes")]),
				targetId: Type.String(),
			}),
			{ description: "write: links to existing memories" },
		),
	),
	scene: Type.Optional(Type.String({ description: "write: short theme name for grouping related memories (reuse across sessions)" })),
	remember: Type.Optional(Type.Boolean({ description: "write: set true only when the user explicitly asks to remember this long-term" })),
});

export const memoryQuerySchema = Type.Object(memoryQueryFields);

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
	readonly entries: readonly Entry[];
	readonly indexById: Map<string, number>;
	readonly readProgress: { index: number };
	readonly knownMemoryIds: Set<string>;
	readonly records: MemoryRecord[];
	readonly onAdded: () => void;
}

interface MemoryToolOptions {
	readonly read?: (opts: QueryMemoryOptions) => Promise<MemoryRecord[]>;
	readonly write?: WriteDeps;
	readonly description?: string;
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
					return `[${entry.id}] ${message ? String(message.role ?? "") : entry.type}: ${content}`;
				})
				.join("\n\n");
			return { content: [{ type: "text", text: body }], details: { ok: true } };
		},
	};
}

function createMemoryTool(opts: MemoryToolOptions): AgentTool<typeof memorySchema | typeof memoryQuerySchema, { ok: boolean; error?: string }> {
	const canWrite = opts.write !== undefined;
	return {
		name: "memory",
		label: "Memory",
		description:
			opts.description ??
			"Read or write this partner's durable memories. read: matches are ranked by relevance when a query is given, otherwise newest first; superseded entries are hidden unless includeSuperseded is true. write: append one record whose rawIds reference raw entries you have already read.",
		parameters: canWrite ? memorySchema : memoryQuerySchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `memory rejected: ${message}` }], details: { ok: false, error: message } });
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });

			if (!isWriteCall(params)) {
				if (!opts.read) return reject("read is not available");
				const memories = await opts.read({
					query: params.query,
					kinds: params.kinds,
					limit: params.limit,
					includeSuperseded: params.includeSuperseded,
				});
				if (memories.length === 0) return note("No memories found.");
				const parts: string[] = [];
				let used = 0;
				let dropped = 0;
				for (const memory of memories) {
					const text = format(memory);
					if (parts.length > 0 && used + text.length > 6000) {
						dropped = memories.length - parts.length;
						break;
					}
					parts.push(text);
					used += text.length;
				}
				let text = parts.join("\n\n");
				if (dropped > 0) text += `\n\n(${memories.length} memories matched; ${dropped} hidden by the output budget — narrow the query or use a smaller limit.)`;
				return note(text);
			}

			const write = opts.write;
			if (!write) return reject("write is not available");
			const kind = params.kind;
			if (!kind) return reject("write needs kind");
			const summary = (params.summary ?? "").trim();
			if (!summary) return reject("write needs summary");
			const rawIds = (params.rawIds ?? []).filter((id) => {
				const index = write.indexById.get(id);
				return index !== undefined && index <= write.readProgress.index;
			});
			if (rawIds.length === 0) return reject("rawIds must reference raw conversation entries you have already read");
			const relations = (params.relations ?? []).filter((relation) => write.knownMemoryIds.has(relation.targetId));
			const scene = params.scene?.trim();
			const record: MemoryRecord = {
				id: `mem-${randomUUID()}`,
				createdAt: Date.now(),
				kind,
				source: { rawIds },
				data: { summary, ...(params.detail ? { detail: params.detail } : {}) },
				...(scene ? { scene } : {}),
				...(params.remember ? { remember: true as const } : {}),
				...(relations.length ? { relations } : {}),
			};
			await appendMemoryLines(write.dir, [record]);
			write.records.push(record);
			write.knownMemoryIds.add(record.id);
			write.onAdded();
			return note(`memory ${record.id} written`);
		},
	};
}

function format(record: MemoryRecord): string {
	const lines = [`# ${record.id} [${record.kind}]`, record.data.summary];
	if (record.data.detail) {
		const detail = record.data.detail.length > 400 ? `${record.data.detail.slice(0, 400)}…` : record.data.detail;
		lines.push(detail);
	}
	return lines.join("\n");
}

export interface OrganizeMemoryOptions {
	readonly dir: string;
	readonly entries: readonly Entry[];
	readonly model: Model<any>;
	readonly streamFn: StreamFn;
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
				const knownMemoryIds = new Set(records.map((memory) => memory.id));
				const agent = createMemoryAgent(opts.model, opts.streamFn, MEMORY_WORKFLOW, [
					createReadRawTool(entries, indexById, passRead),
					createMemoryTool({
						read: async (query) => queryMemory(await readMemoryLines(opts.dir), query),
						write: {
							dir: opts.dir,
							entries,
							indexById,
							readProgress: passRead,
							knownMemoryIds,
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
