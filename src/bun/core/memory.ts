import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { type Model, Type } from "@earendil-works/pi-ai";
import { EVENTS, type MemoryRunEndEventData, type MemoryRunModelMessage, type MemoryRunStartEventData, type MemoryRunTraceEvent } from "../persist/events";
import { convertToLlm, STREAM_FN } from "./agent-config";
import { deriveEventMessage } from "./surface";

export type MemoryKind = "fact" | "decision" | "issue" | "reference" | "event";

export interface MemoryRelation {
	type: "related" | "supersedes";
	targetId: string;
}

export interface MemorySource {
	sessionFile: string;
	rawIds: string[];
}

export interface MemoryRecord {
	id: string;
	createdAt: number;
	kind: MemoryKind;
	source: MemorySource;
	data: { summary: string; detail?: string };
	relations?: MemoryRelation[];
}

export interface MemoryCheckpoint {
	id: string;
	createdAt: number;
	kind: "checkpoint";
	source: { sessionFile: string; lastRawId: string };
}

export type MemoryLine = MemoryRecord | MemoryCheckpoint;

export function formatMemoryRecord(record: MemoryRecord, opts: { withDetail?: boolean } = {}): string {
	const lines = [`# ${record.id} [${record.kind}]`, record.data.summary];
	if (opts.withDetail && record.data.detail) lines.push(record.data.detail);
	return lines.join("\n");
}

export const memoryFilePath = (dir: string) => join(dir, "memory.jsonl");

/** Create an empty memory file when the partner dir has none yet (new partners, old data). */
export async function ensureMemoryFile(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
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
				if (parsed && typeof parsed.id === "string" && typeof parsed.kind === "string") out.push(parsed);
			} catch {
				// skip corrupt lines
			}
		}
		return out;
	} catch {
		return [];
	}
}

export async function appendMemoryLines(dir: string, lines: MemoryLine[]): Promise<void> {
	if (lines.length === 0) return;
	await mkdir(dir, { recursive: true });
	await appendFile(memoryFilePath(dir), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

export function lastCheckpoint(lines: MemoryLine[]): MemoryCheckpoint | null {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line.kind === "checkpoint") return line;
	}
	return null;
}

export interface QueryMemoryOptions {
	query?: string;
	regex?: boolean;
	kinds?: MemoryKind[];
	limit?: number;
	includeSuperseded?: boolean;
}

export function queryMemory(lines: MemoryLine[], opts: QueryMemoryOptions = {}): MemoryRecord[] {
	const limit = opts.limit ?? 20;
	const superseded = new Set<string>();
	if (!opts.includeSuperseded) {
		for (const line of lines) {
			if (line.kind === "checkpoint") continue;
			for (const rel of line.relations ?? []) {
				if (rel.type === "supersedes") superseded.add(rel.targetId);
			}
		}
	}
	const query = opts.query?.trim();
	const re = query && opts.regex ? safeRegex(query) : null;
	const needle = query && !opts.regex ? query.toLowerCase() : null;
	const out: MemoryRecord[] = [];
	for (const line of lines) {
		if (line.kind === "checkpoint") continue;
		if (!opts.includeSuperseded && superseded.has(line.id)) continue;
		if (opts.kinds?.length && !opts.kinds.includes(line.kind)) continue;
		const text = `${line.data.summary}\n${line.data.detail ?? ""}`;
		if (needle && !text.toLowerCase().includes(needle)) continue;
		if (re && !re.test(text)) continue;
		out.push(line);
	}
	out.sort((a, b) => b.createdAt - a.createdAt);
	return out.slice(0, limit);
}

function safeRegex(source: string): RegExp | null {
	try {
		return new RegExp(source, "i");
	} catch {
		return null;
	}
}

const MEMORY_WORKFLOW = `You are running a memory extraction loop for this partner.

Workflow:
1. The user tells you where to start reading raw conversation entries and which raw id must be covered.
2. Call read_raw to inspect raw entries. Keep reading forward until you have seen the latest raw entries.
3. When you need context about existing memories, call read_memory.
4. For each durable memory or objective user event, call write_memory with kind, summary, detail, rawIds and optional relations.
   - rawIds must be chosen from the raw ids you actually read.
   - Use relation type "related" when the new memory connects to an existing memory.
   - Use relation type "supersedes" when the new memory replaces an existing memory.
5. Once you have read through the target raw id and written every durable memory or event you found, call finish.

Allowed memory kinds: fact, decision, issue, reference, event.
Do NOT extract preferences, conventions, or task checklists.

An event is an objective user-driven episode: a coherent thing the user did, asked, or accomplished across one or more messages. State only what happened — never infer preferences, motives, or conventions.

Event guidance (REQUIRED):
- Write an event for every substantive user question, request, or instruction you find. Do not require it to be a reusable fact or future-relevant; events are objective history.
- Examples of event summaries: "User asked what the current time was.", "User requested a random table.", "User asked what a TOON code fence is."
- Merge multi-turn messages that are all about the same intent into ONE event and list all their raw ids. Start a new event when the user's intent changes.
- Prefer merging over splitting: when consecutive messages belong to the same larger effort, keep them in one event even if they contain several related sub-questions; split only when the user clearly switches topic.`;

const memoryKindSchema = Type.Union([Type.Literal("fact"), Type.Literal("decision"), Type.Literal("issue"), Type.Literal("reference"), Type.Literal("event")]);

export const readMemorySchema = Type.Object({
	query: Type.Optional(Type.String({ description: "Keyword or regex pattern to match against memory text" })),
	regex: Type.Optional(Type.Boolean({ description: "Treat query as a regular expression (default false)" })),
	kinds: Type.Optional(Type.Array(memoryKindSchema)),
	limit: Type.Optional(Type.Integer({ description: "Maximum memories to return (default 20)" })),
	includeSuperseded: Type.Optional(Type.Boolean({ description: "Include memories that have been superseded (default false)" })),
});

const readRawSchema = Type.Object({
	from: Type.String({ description: "Start reading from this raw id (inclusive); always pass the starting id from the prompt" }),
	limit: Type.Optional(Type.Integer({ description: "Maximum entries to return (default 50)" })),
});

const writeMemorySchema = Type.Object({
	kind: memoryKindSchema,
	summary: Type.String({ description: "Short durable memory statement" }),
	detail: Type.Optional(Type.String({ description: "Optional supporting detail" })),
	rawIds: Type.Array(Type.String({ description: "Origin raw entry ids this memory came from" })),
	relations: Type.Optional(
		Type.Array(
			Type.Object({
				type: Type.Union([Type.Literal("related"), Type.Literal("supersedes")]),
				targetId: Type.String(),
			}),
		),
	),
});

const finishSchema = Type.Object({});

export interface OrganizeMemoryOptions {
	dir: string;
	sessionFile: string;
	entries: Entry[];
	model?: Model<any>;
	signal?: AbortSignal;
	/** Optional raw-origin audit logger: appends memory/run/start and memory/run/end. */
	logRun?: {
		start(data: MemoryRunStartEventData): Promise<void>;
		end(data: MemoryRunEndEventData): Promise<void>;
	};
}

const MAX_ORGANIZE_ATTEMPTS = 5;
const MAX_TRACE_EVENTS = 2000;
type PushTrace = (event: MemoryRunTraceEvent) => void;

export async function organizeMemory(opts: OrganizeMemoryOptions): Promise<number> {
	await ensureMemoryFile(opts.dir);
	// Memory-run audit entries are log-only; never feed them back into extraction.
	const entries = opts.entries.filter((e) => !isMemoryRunEntry(e));
	if (!opts.model || entries.length === 0) return 0;

	const lines = await readMemoryLines(opts.dir);
	const records = lines.filter((l): l is MemoryRecord => l.kind !== "checkpoint");
	const sessionRecords = records.filter((m) => m.source.sessionFile === opts.sessionFile);
	const indexById = entryIndexById(entries);
	const targetRawId = entries.at(-1)!.id;
	const targetIndex = indexById.get(targetRawId) ?? entries.length - 1;
	let added = 0;

	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	const trace: MemoryRunTraceEvent[] = [];
	const modelMessages: MemoryRunModelMessage[] = [];
	const checkpoints: string[] = [];
	const pushTrace: PushTrace = (event) => {
		if (trace.length < MAX_TRACE_EVENTS) trace.push({ ...event, at: Date.now() });
	};
	const logStart = opts.logRun?.start;
	const logEnd = opts.logRun?.end;
	let attempts = 0;

	// 补齐：crash / attempts-exhausted 后可能只有 memory records、没有对应 checkpoint。
	// 在依赖 checkpointIndexForSession 之前，先按 memory records 的进度补一个 checkpoint。
	const existingCursor = checkpointIndexForSession(lines, opts.sessionFile, indexById);
	const recovered = recordProgressIndex(sessionRecords, indexById);
	let cursorIndex = Math.max(existingCursor, recovered);
	if (recovered > existingCursor) {
		const rawId = entries[recovered].id;
		await appendMemoryLines(opts.dir, [makeCheckpoint(opts.sessionFile, rawId)]);
		checkpoints.push(rawId);
		pushTrace({ event: "checkpoint", lastRawId: rawId });
	}

	if (logStart && cursorIndex < targetIndex) {
		try {
			await logStart({
				runId,
				sessionFile: opts.sessionFile,
				startedAt,
				entries: entries.length,
				targetRawId,
				cursorRawId: cursorIndex >= 0 ? entries[cursorIndex].id : null,
			});
		} catch (error) {
			console.error("memory run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunEndEventData["reason"], error?: string) {
		if (!logEnd) return;
		const endedAt = Date.now();
		try {
			await logEnd({
				runId,
				sessionFile: opts.sessionFile,
				startedAt,
				endedAt,
				durationMs: endedAt - startedAt,
				reason,
				attempts,
				added,
				...(error ? { error } : {}),
				...(checkpoints.length ? { checkpoints } : {}),
				...(trace.length ? { trace } : {}),
				...(modelMessages.length ? { modelMessages } : {}),
			});
		} catch (logError) {
			console.error("memory run end log failed:", logError);
		}
	}

	if (cursorIndex >= targetIndex) return added;

	let progressIndex = cursorIndex;
	try {
		while (attempts < MAX_ORGANIZE_ATTEMPTS) {
			if (isCovered(sessionRecords, targetRawId) || progressIndex >= targetIndex) break;
			const startIndex = Math.max(0, progressIndex + 1);
			const readProgress = { index: -1 };
			const done = { value: false };
			const knownMemoryIds = new Set(records.map((m) => m.id));

			const agent = new Agent({
				streamFn: STREAM_FN,
				convertToLlm,
			});
			agent.state.model = opts.model;
			agent.state.systemPrompt = MEMORY_WORKFLOW;
			agent.state.tools = [
				createReadRawTool(entries, indexById, readProgress, pushTrace),
				createReadMemoryTool({
					read: async (o) => queryMemory(await readMemoryLines(opts.dir), o),
					pushTrace,
				}),
				createWriteMemoryTool({
					dir: opts.dir,
					sessionFile: opts.sessionFile,
					indexById,
					readProgress,
					knownMemoryIds,
					records,
					sessionRecords,
					pushTrace,
					onAdded: () => (added += 1),
				}),
				createFinishTool(done, pushTrace),
			];
			if (opts.signal?.aborted) break;
			const onAbort = () => agent.abort();
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			try {
				await agent.prompt(`There are still some logs waiting to be extracted. Please read from ${entries[startIndex].id}. The last raw id to cover is ${targetRawId}.`);
				await agent.waitForIdle();
			} finally {
				opts.signal?.removeEventListener("abort", onAbort);
			}
			if (opts.signal?.aborted) break;
			attempts += 1;
			collectModelMessages(agent.state.messages, attempts, modelMessages);

			// 只更新内存进度用于下一轮起点，不落盘：正常结束时统一写一个 checkpoint。
			progressIndex = Math.max(progressIndex, readProgress.index, recordProgressIndex(sessionRecords, indexById));
			pushTrace({ event: "attempt_end", attempt: attempts, progressRawId: progressIndex >= 0 ? entries[progressIndex].id : null });
		}

		// 正常流程结束才 append checkpoint：读完 target（无论是否产出 memory）或 target 已被 memory 覆盖。
		if (progressIndex >= targetIndex && cursorIndex < targetIndex) {
			const rawId = entries[targetIndex].id;
			await appendMemoryLines(opts.dir, [makeCheckpoint(opts.sessionFile, rawId)]);
			checkpoints.push(rawId);
			pushTrace({ event: "checkpoint", lastRawId: rawId });
		} else if (attempts >= MAX_ORGANIZE_ATTEMPTS && progressIndex > cursorIndex && progressIndex < targetIndex) {
			// attempts-exhausted：把本轮实际推进写成一个部分 checkpoint，下次从这里之后继续。
			const rawId = entries[progressIndex].id;
			await appendMemoryLines(opts.dir, [makeCheckpoint(opts.sessionFile, rawId)]);
			checkpoints.push(rawId);
			pushTrace({ event: "checkpoint", lastRawId: rawId });
		}
		await endRun(opts.signal?.aborted ? "interrupted" : progressIndex >= targetIndex ? "completed" : "attempts-exhausted");
		return added;
	} catch (error) {
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	}
}

function isMemoryRunEntry(entry: Entry): boolean {
	return entry.type === "custom" && (entry.customType === EVENTS.memoryRunStart || entry.customType === EVENTS.memoryRunEnd);
}

function collectModelMessages(messages: AgentMessage[], attempt: number, out: MemoryRunModelMessage[]): void {
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) {
			const b = block as { type?: string; text?: unknown; thinking?: unknown };
			if (b.type === "thinking" && typeof b.thinking === "string") out.push({ attempt, role: "assistant", block: "thinking", text: b.thinking });
			else if (b.type === "text" && typeof b.text === "string") out.push({ attempt, role: "assistant", block: "text", text: b.text });
		}
	}
}

function entryIndexById(entries: Entry[]): Map<string, number> {
	return new Map(entries.map((e, i) => [e.id, i]));
}

function checkpointIndexForSession(lines: MemoryLine[], sessionFile: string, indexById: Map<string, number>): number {
	let best = -1;
	for (const line of lines) {
		if (line.kind !== "checkpoint" || line.source.sessionFile !== sessionFile) continue;
		const idx = indexById.get(line.source.lastRawId);
		if (idx != null && idx > best) best = idx;
	}
	return best;
}

function recordProgressIndex(sessionRecords: MemoryRecord[], indexById: Map<string, number>): number {
	let best = -1;
	for (const record of sessionRecords) {
		for (const rawId of record.source.rawIds) {
			const idx = indexById.get(rawId);
			if (idx != null && idx > best) best = idx;
		}
	}
	return best;
}

function makeCheckpoint(sessionFile: string, lastRawId: string): MemoryCheckpoint {
	return { id: `chk-${randomUUID()}`, createdAt: Date.now(), kind: "checkpoint", source: { sessionFile, lastRawId } };
}

function isCovered(records: MemoryRecord[], rawId: string): boolean {
	return records.some((m) => m.source.rawIds.includes(rawId));
}

function createReadRawTool(
	entries: Entry[],
	indexById: Map<string, number>,
	progress: { index: number },
	pushTrace: PushTrace,
): AgentTool<typeof readRawSchema, { ok: boolean; error?: string }> {
	return {
		name: "read_raw",
		label: "Read Raw",
		description: "Read raw conversation entries from a starting raw id (inclusive). Always pass the starting id given in the prompt and keep moving forward.",
		parameters: readRawSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const startIdx = indexById.get(params.from);
			if (startIdx == null) {
				pushTrace({ event: "read_raw", from: params.from, limit: params.limit ?? 50, returned: 0, error: "unknown from" });
				return {
					content: [{ type: "text", text: `Unknown raw id "${params.from}". Start from the id provided in the prompt.` }],
					details: { ok: false, error: "unknown from raw id" },
				};
			}
			const limit = Math.max(1, params.limit ?? 50);
			const selected = entries.slice(startIdx, startIdx + limit);
			const last = selected.at(-1);
			if (last) {
				const lastIdx = indexById.get(last.id);
				if (lastIdx != null) progress.index = Math.max(progress.index, lastIdx);
			}
			pushTrace({ event: "read_raw", from: params.from, limit, returned: selected.length });
			const text = selected
				.map((e) => {
					if (e.type === "custom" && e.customType === EVENTS.timeGapReminder) return `[${e.id}] time_gap_reminder (skipped)`;
					if (e.type === "custom" && (e.customType === EVENTS.contextChanged || e.customType === EVENTS.instructionsChanged)) return `[${e.id}] ${e.customType} (skipped)`;
					const msg = deriveEventMessage(e);
					const m = msg as { role?: unknown; content?: unknown } | null;
					const content = m ? (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")) : JSON.stringify(e);
					return `[${e.id}] ${m ? String(m.role ?? "") : e.type}: ${content}`;
				})
				.join("\n\n");
			return { content: [{ type: "text", text }], details: { ok: true } };
		},
	};
}

export interface ReadMemoryToolOptions {
	read?: (opts: QueryMemoryOptions) => Promise<MemoryRecord[]>;
	pushTrace?: PushTrace;
	description?: string;
}

export function createReadMemoryTool(opts: ReadMemoryToolOptions): AgentTool<typeof readMemorySchema, { ok: boolean; error?: string }> {
	return {
		name: "read_memory",
		label: "Read Memory",
		description: opts.description ?? "Read durable memories for this partner. Returns newest first; superseded entries are hidden unless includeSuperseded is true.",
		parameters: readMemorySchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			if (!opts.read) {
				return { content: [{ type: "text", text: "read_memory is not available" }], details: { ok: false, error: "read_memory is not available" } };
			}
			const memories = await opts.read(params);
			opts.pushTrace?.({
				event: "read_memory",
				...(params.query ? { query: params.query } : {}),
				...(params.regex ? { regex: true } : {}),
				returned: memories.length,
			});
			if (memories.length === 0) {
				return { content: [{ type: "text", text: "No memories found." }], details: { ok: true } };
			}
			const text = memories.map((m) => formatMemoryRecord(m, { withDetail: true })).join("\n\n");
			return { content: [{ type: "text", text }], details: { ok: true } };
		},
	};
}

interface WriteMemoryToolDeps {
	dir: string;
	sessionFile: string;
	indexById: Map<string, number>;
	readProgress: { index: number };
	knownMemoryIds: Set<string>;
	records: MemoryRecord[];
	sessionRecords: MemoryRecord[];
	pushTrace: PushTrace;
	onAdded: () => void;
}

function createWriteMemoryTool(deps: WriteMemoryToolDeps): AgentTool<typeof writeMemorySchema, { ok: boolean; error?: string }> {
	return {
		name: "write_memory",
		label: "Write Memory",
		description: "Append one durable memory record for this partner. rawIds must reference raw entries you have already read in this pass.",
		parameters: writeMemorySchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const rawIds = params.rawIds.filter((id) => {
				const idx = deps.indexById.get(id);
				return idx != null && idx <= deps.readProgress.index;
			});
			if (rawIds.length === 0) {
				deps.pushTrace({ event: "write_memory", kind: params.kind, rawIds: params.rawIds, accepted: false, error: "invalid rawIds" });
				return {
					content: [{ type: "text", text: "write_memory rejected: rawIds must reference raw entries you have already read." }],
					details: { ok: false, error: "invalid rawIds" },
				};
			}
			const relations = (params.relations ?? []).filter((r) => deps.knownMemoryIds.has(r.targetId));
			const record: MemoryRecord = {
				id: `mem-${randomUUID()}`,
				createdAt: Date.now(),
				kind: params.kind,
				source: { sessionFile: deps.sessionFile, rawIds },
				data: { summary: params.summary, ...(params.detail ? { detail: params.detail } : {}) },
				...(relations.length ? { relations } : {}),
			};
			await appendMemoryLines(deps.dir, [record]);
			deps.records.push(record);
			deps.sessionRecords.push(record);
			deps.knownMemoryIds.add(record.id);
			deps.onAdded();
			deps.pushTrace({ event: "write_memory", kind: params.kind, rawIds: params.rawIds, accepted: true, memoryId: record.id });
			return { content: [{ type: "text", text: `memory ${record.id} written` }], details: { ok: true } };
		},
	};
}

function createFinishTool(done: { value: boolean }, pushTrace: PushTrace): AgentTool<typeof finishSchema, { ok: boolean }> {
	return {
		name: "finish",
		label: "Finish",
		description: "Finish the memory extraction loop once the target raw id is covered.",
		parameters: finishSchema,
		executionMode: "sequential",
		async execute() {
			done.value = true;
			pushTrace({ event: "finish" });
			return { content: [{ type: "text", text: "Memory extraction finished." }], details: { ok: true }, terminate: true };
		},
	};
}
