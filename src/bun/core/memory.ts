import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { type Model, type Static, Type } from "@earendil-works/pi-ai";
import { projectSlice } from "../../shared/entry-meta";
import type { MemoryRunUsage, MemoryTrajectoryAttemptView, MemoryTrajectoryMessageView } from "../../shared/rpc";
import { EVENTS, type MemoryRunEndEventData, type MemoryRunEndReason, type MemoryRunStage, type MemoryRunStartEventData, type MemoryRunTraceEvent } from "../persist/events";
import { convertToLlm, STREAM_FN } from "./agent-config";
import { runRalphLoop } from "./ralph-loop";

export type MemoryKind = "fact" | "decision" | "issue" | "reference" | "event" | "preference" | "instruction";

export interface MemoryRelation {
	type: "related" | "supersedes";
	targetId: string;
}

export interface MemorySource {
	rawIds: string[];
}

export interface MemoryRecord {
	id: string;
	createdAt: number;
	kind: MemoryKind;
	source: MemorySource;
	data: { summary: string; detail?: string };
	relations?: MemoryRelation[];
	scene?: string;
	remember?: true;
}

export interface MemoryCheckpoint {
	id: string;
	createdAt: number;
	kind: "checkpoint";
	source: { lastRawId: string };
	tail?: true;
}

export type MemoryLine = MemoryRecord | MemoryCheckpoint;

export interface MemoryTrajectoryMessage {
	role: string;
	content: unknown;
	timestamp?: number;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	stopReason?: string;
	errorMessage?: string;
}

export interface MemoryTrajectoryAttempt {
	attempt: number;
	messages: MemoryTrajectoryMessage[];
}

export interface MemoryRunRecord {
	runId: string;
	stage: MemoryRunStage;
	model: string;
	startedAt: number;
	endedAt: number;
	durationMs: number;
	reason: MemoryRunEndReason;
	attempts: number;
	added: number;
	targetRawId: string | null;
	cursorRawId: string | null;
	throughMemoryId?: string;
	throughSceneRevId?: string;
	error?: string;
	checkpoints?: string[];
	trace?: MemoryRunTraceEvent[];
	usage?: MemoryRunUsage;
	systemPrompt: string;
	trajectory: MemoryTrajectoryAttempt[];
}

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

export const memoryDir = (dir: string) => join(dir, ".memory");
export const memoryFilePath = (dir: string) => join(memoryDir(dir), "memories.jsonl");
export const memoryRunsFilePath = (dir: string) => join(memoryDir(dir), "runs.jsonl");

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
				if (parsed && typeof parsed.id === "string" && typeof parsed.kind === "string") out.push(parsed);
			} catch {}
		}
		return out;
	} catch {
		return [];
	}
}

export async function appendMemoryLines(dir: string, lines: MemoryLine[]): Promise<void> {
	if (lines.length === 0) return;
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(memoryFilePath(dir), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

export async function appendMemoryRun(dir: string, record: MemoryRunRecord): Promise<void> {
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(memoryRunsFilePath(dir), `${JSON.stringify(record)}\n`, "utf8");
}

export interface MemoryRunSummary {
	runId: string;
	stage: MemoryRunStage;
	model: string;
	startedAt: number;
	endedAt: number;
	durationMs: number;
	reason: MemoryRunEndReason;
	added: number;
	usage?: MemoryRunUsage;
	bytes: number;
}

export async function readMemoryRunSummaries(dir: string, limit = 5): Promise<{ runs: MemoryRunSummary[]; total: number }> {
	try {
		const raw = await readFile(memoryRunsFilePath(dir), "utf8");
		const lines = raw.split("\n").filter((line) => line.trim());
		const runs: MemoryRunSummary[] = [];
		for (const line of lines.slice(-limit)) {
			try {
				const parsed = JSON.parse(line) as MemoryRunRecord;
				runs.push({
					runId: parsed.runId,
					stage: parsed.stage,
					model: parsed.model,
					startedAt: parsed.startedAt,
					endedAt: parsed.endedAt,
					durationMs: parsed.durationMs,
					reason: parsed.reason,
					added: parsed.added,
					...(parsed.usage ? { usage: parsed.usage } : {}),
					bytes: Buffer.byteLength(line, "utf8"),
				});
			} catch {}
		}
		return { runs: runs.reverse(), total: lines.length };
	} catch {
		return { runs: [], total: 0 };
	}
}

export async function readMemoryRun(dir: string, runId: string): Promise<MemoryRunRecord | null> {
	try {
		const raw = await readFile(memoryRunsFilePath(dir), "utf8");
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as MemoryRunRecord;
				if (parsed.runId === runId) return parsed;
			} catch {}
		}
		return null;
	} catch {
		return null;
	}
}

export function projectMemoryTrajectory(trajectory: MemoryTrajectoryAttempt[]): MemoryTrajectoryAttemptView[] {
	return trajectory.map((attempt) => ({ attempt: attempt.attempt, messages: attempt.messages.map(projectMessage) }));
}

function asText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function projectMessage(message: MemoryTrajectoryMessage): MemoryTrajectoryMessageView {
	const view: MemoryTrajectoryMessageView = {
		role: message.role,
		...(message.toolName ? { toolName: message.toolName } : {}),
		...(message.isError ? { isError: true } : {}),
		...(message.stopReason ? { stopReason: message.stopReason } : {}),
		...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
	};
	const blocks = Array.isArray(message.content) ? message.content : null;
	if (!blocks) {
		const text = asText(message.content);
		if (text) view.text = text;
		return view;
	}
	const texts: string[] = [];
	const thoughts: string[] = [];
	const calls: { name: string; args: string }[] = [];
	for (const raw of blocks) {
		const block = raw as { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; arguments?: unknown } | null;
		if (!block || typeof block.type !== "string") continue;
		if (block.type === "text") {
			const text = asText(block.text);
			if (text) texts.push(text);
		} else if (block.type === "thinking") {
			const text = asText(block.thinking) || asText(block.text);
			if (text) thoughts.push(text);
		} else if (block.type === "toolCall") {
			calls.push({ name: asText(block.name), args: stringifyArgs(block.arguments) });
		}
	}
	if (texts.length) view.text = texts.join("\n");
	if (thoughts.length) view.thinking = thoughts.join("\n");
	if (calls.length) view.toolCalls = calls;
	return view;
}

function stringifyArgs(args: unknown): string {
	try {
		return typeof args === "string" ? args : JSON.stringify(args);
	} catch {
		return String(args);
	}
}

export function lastCheckpoint(lines: MemoryLine[]): MemoryCheckpoint | null {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line.kind === "checkpoint") return line;
	}
	return null;
}

export function checkpointCoversSession(checkpoints: MemoryCheckpoint[], entries: Entry[]): boolean {
	const last = extractionEntries(entries).at(-1);
	return last != null && checkpoints.some((checkpoint) => checkpoint.tail === true && checkpoint.source.lastRawId === last.id);
}

export function memoryCoveredIndex(lines: MemoryLine[], entries: Entry[]): number {
	return latestCheckpointIndex(lines, new Map(entries.map((e, i) => [e.id, i])));
}

export interface QueryMemoryOptions {
	query?: string;
	kinds?: MemoryKind[];
	limit?: number;
	includeSuperseded?: boolean;
}

/**
 * A query matches in two passes and the scores add: every separator-delimited term as a case-insensitive
 * substring, and the untouched query as a regex. A record matching more terms — or the whole phrase —
 * therefore ranks above one matching a single term, and one record is still one result.
 */
const QUERY_SEPARATORS = /[\s|,，、;；/／｜]+/;

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
	if (hits !== null) matched.sort((a, b) => b.score - a.score || b.record.createdAt - a.record.createdAt);
	else matched.sort((a, b) => b.record.createdAt - a.record.createdAt);
	return matched.slice(0, limit).map((m) => m.record);
}

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

/** The query half of the tool, shared by the read-only profile and the read/write one. */
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

/** What a tool without a write path exposes: the query half, and no `op` to pick between two of them. */
const memoryQuerySchema = Type.Object(memoryQueryFields);

type MemoryToolParams = Static<typeof memorySchema> | Static<typeof memoryQuerySchema>;

function isWriteCall(params: MemoryToolParams): params is Static<typeof memorySchema> {
	return "op" in params && params.op === "write";
}

const readRawSchema = Type.Object({
	from: Type.String({ description: "Start reading from this raw id (inclusive); always pass the starting id from the prompt" }),
	limit: Type.Optional(Type.Integer({ description: "Maximum entries to return (default 50)" })),
});

export interface OrganizeMemoryOptions {
	dir: string;
	entries: Entry[];
	model?: Model<any>;
	signal?: AbortSignal;
	logRun?: {
		start(data: MemoryRunStartEventData): Promise<void>;
		end(data: MemoryRunEndEventData): Promise<void>;
	};
}

const MAX_ORGANIZE_ATTEMPTS = 5;
const MAX_TRACE_EVENTS = 2000;
type PushTrace = (event: MemoryRunTraceEvent) => void;

function isExtractableEntry(entry: Entry): boolean {
	if (entry.type === "message") return entry.message.role === "user" || entry.message.role === "assistant";
	return entry.type === "custom" && entry.customType === EVENTS.sendMessage;
}

export async function organizeMemory(opts: OrganizeMemoryOptions): Promise<number> {
	// ——— batch, cursor and run identity ———
	await ensureMemoryFile(opts.dir);
	const entries = extractionEntries(opts.entries);
	const model = opts.model;
	if (!model || entries.length === 0) return 0;

	const lines = await readMemoryLines(opts.dir);
	const records = lines.filter((l): l is MemoryRecord => l.kind !== "checkpoint");
	const indexById = entryIndexById(entries);
	const targetRawId = entries.at(-1)!.id;
	const targetIndex = indexById.get(targetRawId) ?? entries.length - 1;

	const runModelName = `${model.provider}/${model.id ?? "default"}`;
	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	const trace: MemoryRunTraceEvent[] = [];
	const trajectory: MemoryTrajectoryAttempt[] = [];
	const checkpoints: string[] = [];
	const usage = emptyMemoryUsage();
	const pushTrace: PushTrace = (event) => {
		if (trace.length < MAX_TRACE_EVENTS) trace.push({ ...event, at: Date.now() });
	};
	const logStart = opts.logRun?.start;
	const logEnd = opts.logRun?.end;
	let attempts = 0;
	let added = 0;

	const existingCursor = latestCheckpointIndex(lines, indexById);
	const recovered = recordProgressIndex(records, indexById);
	let cursorIndex = Math.max(existingCursor, recovered);
	if (recovered > existingCursor) {
		const rawId = entries[recovered].id;
		await appendMemoryLines(opts.dir, [makeCheckpoint(rawId, recovered >= targetIndex)]);
		checkpoints.push(rawId);
		pushTrace({ event: "checkpoint", lastRawId: rawId });
	}

	// ——— run log ———
	if (logStart && cursorIndex < targetIndex) {
		try {
			await logStart({ runId, stage: "memory", startedAt });
		} catch (error) {
			console.error("memory run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunEndReason, error?: string) {
		const endedAt = Date.now();
		if (logEnd) {
			try {
				await logEnd({ runId, stage: "memory", startedAt, endedAt, reason, added });
			} catch (logError) {
				console.error("memory run end log failed:", logError);
			}
		}
		try {
			await appendMemoryRun(opts.dir, {
				runId,
				stage: "memory",
				model: runModelName,
				startedAt,
				endedAt,
				durationMs: endedAt - startedAt,
				reason,
				attempts,
				added,
				targetRawId,
				cursorRawId: cursorIndex >= 0 ? entries[cursorIndex].id : null,
				...(error ? { error } : {}),
				...(checkpoints.length ? { checkpoints } : {}),
				...(trace.length ? { trace } : {}),
				...(usage.calls ? { usage } : {}),
				systemPrompt: MEMORY_WORKFLOW,
				trajectory,
			});
		} catch (runError) {
			console.error("memory run trajectory append failed:", runError);
		}
	}

	if (cursorIndex >= targetIndex) return added;

	// ——— extraction loop ———
	let passRead = { index: -1 };
	try {
		const loop = await runRalphLoop({
			maxAttempts: MAX_ORGANIZE_ATTEMPTS,
			signal: opts.signal,
			onPass: (pass, messages) => {
				trajectory.push({ attempt: pass, messages: snapshotTrajectory(messages) });
				addMessageUsage(usage, messages);
			},
			createPass: () => {
				passRead = { index: -1 };
				const startIndex = Math.max(0, cursorIndex + 1);
				const knownMemoryIds = new Set(records.map((m) => m.id));
				const agent = new Agent({
					streamFn: STREAM_FN,
					convertToLlm,
				});
				agent.state.model = model;
				agent.state.systemPrompt = MEMORY_WORKFLOW;
				agent.state.tools = [
					createReadRawTool(entries, indexById, passRead, pushTrace),
					createMemoryTool({
						read: async (o) => queryMemory(await readMemoryLines(opts.dir), o),
						write: {
							dir: opts.dir,
							entries,
							indexById,
							readProgress: passRead,
							knownMemoryIds,
							records,
							onAdded: () => (added += 1),
						},
						pushTrace,
					}),
				];
				return { agent, prompt: `There are still some logs waiting to be extracted. Please read from ${entries[startIndex].id}. The last raw id to cover is ${targetRawId}.` };
			},
			settlePass: async (pass) => {
				const reached = Math.min(targetIndex, Math.max(passRead.index, recordProgressIndex(records, indexById)));
				pushTrace({ event: "attempt_end", attempt: pass, progressRawId: reached >= 0 ? entries[reached].id : null });
				if (reached <= cursorIndex) return "stalled";
				cursorIndex = reached;
				const rawId = entries[cursorIndex].id;
				await appendMemoryLines(opts.dir, [makeCheckpoint(rawId, cursorIndex >= targetIndex)]);
				checkpoints.push(rawId);
				pushTrace({ event: "checkpoint", lastRawId: rawId });
				return cursorIndex >= targetIndex ? "done" : "advanced";
			},
		});
		attempts = loop.attempts;
		await endRun(loop.reason);
		return added;
	} catch (error) {
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	}
}

export function isMemoryInternalEntry(entry: Entry): boolean {
	return entry.type === "custom" && (entry.customType === EVENTS.memoryRunStart || entry.customType === EVENTS.memoryRunEnd || entry.customType === EVENTS.memoryContext);
}

function prepareEntries(entries: Entry[]): Entry[] {
	const rewoundIds = new Set<string>();
	for (const e of entries) {
		if (e.type === "custom" && e.customType === EVENTS.rewind) {
			const data = e.data as { targetId?: unknown; shadowedIds?: unknown } | undefined;
			if (typeof data?.targetId === "string") rewoundIds.add(data.targetId);
			const shadowed = data?.shadowedIds;
			if (Array.isArray(shadowed)) for (const id of shadowed) if (typeof id === "string") rewoundIds.add(id);
		}
	}
	return entries.filter((e) => !isMemoryInternalEntry(e) && !rewoundIds.has(e.id));
}

export function extractionEntries(entries: Entry[]): Entry[] {
	return prepareEntries(entries).filter(isExtractableEntry);
}

export interface MemoryPendingStatus {
	pending: boolean;
	rounds: number;
}

export async function memoryPendingStatus(dir: string, entries: Entry[]): Promise<MemoryPendingStatus> {
	const prepared = extractionEntries(entries);
	if (prepared.length === 0) return { pending: false, rounds: 0 };
	const lines = await readMemoryLines(dir);
	const indexById = entryIndexById(prepared);
	const records = lines.filter((l): l is MemoryRecord => l.kind !== "checkpoint");
	const cursor = Math.max(latestCheckpointIndex(lines, indexById), recordProgressIndex(records, indexById));
	let rounds = 0;
	for (let i = Math.max(0, cursor + 1); i < prepared.length; i++) {
		const entry = prepared[i];
		if (entry.type === "message" && entry.message.role === "user") rounds += 1;
	}
	return { pending: cursor < prepared.length - 1, rounds };
}

export function emptyMemoryUsage(): MemoryRunUsage {
	return { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addMessageUsage(target: MemoryRunUsage, messages: AgentMessage[]): void {
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const usage = (message as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }).usage;
		if (!usage) continue;
		target.calls += 1;
		target.input += usage.input ?? 0;
		target.output += usage.output ?? 0;
		target.cacheRead += usage.cacheRead ?? 0;
		target.cacheWrite += usage.cacheWrite ?? 0;
	}
}

export function snapshotTrajectory(messages: AgentMessage[]): MemoryTrajectoryMessage[] {
	const out: MemoryTrajectoryMessage[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue;
		const m = message as unknown as {
			content?: unknown;
			timestamp?: unknown;
			toolCallId?: unknown;
			toolName?: unknown;
			isError?: unknown;
			stopReason?: unknown;
			errorMessage?: unknown;
		};
		out.push({
			role: message.role,
			content: m.content ?? null,
			...(typeof m.timestamp === "number" ? { timestamp: m.timestamp } : {}),
			...(typeof m.toolCallId === "string" ? { toolCallId: m.toolCallId } : {}),
			...(typeof m.toolName === "string" ? { toolName: m.toolName } : {}),
			...(m.isError === true ? { isError: true } : {}),
			...(typeof m.stopReason === "string" ? { stopReason: m.stopReason } : {}),
			...(typeof m.errorMessage === "string" && m.errorMessage ? { errorMessage: m.errorMessage } : {}),
		});
	}
	return out;
}

function entryIndexById(entries: Entry[]): Map<string, number> {
	return new Map(entries.map((e, i) => [e.id, i]));
}

function latestCheckpointIndex(lines: MemoryLine[], indexById: Map<string, number>): number {
	let best = -1;
	for (const line of lines) {
		if (line.kind !== "checkpoint") continue;
		const idx = indexById.get(line.source.lastRawId);
		if (idx != null && idx > best) best = idx;
	}
	return best;
}

function recordProgressIndex(records: MemoryRecord[], indexById: Map<string, number>): number {
	let best = -1;
	for (const record of records) {
		for (const rawId of record.source.rawIds) {
			const idx = indexById.get(rawId);
			if (idx != null && idx > best) best = idx;
		}
	}
	return best;
}

function makeCheckpoint(lastRawId: string, tail = false): MemoryCheckpoint {
	return { id: `chk-${randomUUID()}`, createdAt: Date.now(), kind: "checkpoint", source: { lastRawId }, ...(tail ? { tail: true as const } : {}) };
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
			const body = selected
				.map((e) => {
					const msg = projectSlice([e])[0] ?? null;
					const m = msg as { role?: unknown; content?: unknown } | null;
					const content = m ? (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")) : JSON.stringify(e);
					return `[${e.id}] ${m ? String(m.role ?? "") : e.type}: ${content}`;
				})
				.join("\n\n");
			return { content: [{ type: "text", text: body }], details: { ok: true } };
		},
	};
}

export interface MemoryWriteDeps {
	dir: string;
	entries: Entry[];
	indexById: Map<string, number>;
	readProgress: { index: number };
	knownMemoryIds: Set<string>;
	records: MemoryRecord[];
	onAdded: () => void;
}

export interface MemoryToolOptions {
	read?: (opts: QueryMemoryOptions) => Promise<MemoryRecord[]>;
	write?: MemoryWriteDeps;
	pushTrace?: PushTrace;
	description?: string;
}

export const RECALL_MAX_DETAIL_CHARS = 400;
const RECALL_MAX_TOTAL_CHARS = 6000;

export function createMemoryTool(opts: MemoryToolOptions): AgentTool<typeof memorySchema | typeof memoryQuerySchema, { ok: boolean; error?: string }> {
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
				opts.pushTrace?.({
					event: "read_memory",
					...(params.query ? { query: params.query } : {}),
					returned: memories.length,
				});
				if (memories.length === 0) return note("No memories found.");
				const parts: string[] = [];
				let used = 0;
				let dropped = 0;
				for (const memory of memories) {
					const text = formatMemoryRecord(memory, { withDetail: true, maxDetailChars: RECALL_MAX_DETAIL_CHARS });
					if (parts.length > 0 && used + text.length > RECALL_MAX_TOTAL_CHARS) {
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
			const requestedRawIds = params.rawIds ?? [];
			const rawIds = requestedRawIds.filter((id) => {
				const idx = write.indexById.get(id);
				return idx != null && idx <= write.readProgress.index && isExtractableEntry(write.entries[idx]);
			});
			if (rawIds.length === 0) {
				opts.pushTrace?.({ event: "write_memory", kind, rawIds: requestedRawIds, accepted: false, error: "invalid rawIds" });
				return reject("rawIds must reference raw conversation entries you have already read");
			}
			const relations = (params.relations ?? []).filter((r) => write.knownMemoryIds.has(r.targetId));
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
			opts.pushTrace?.({ event: "write_memory", kind, rawIds, accepted: true, memoryId: record.id });
			return note(`memory ${record.id} written`);
		},
	};
}

const MAX_CONSOLIDATE_ATTEMPTS = 3;
const MAX_CONSOLIDATE_RECORDS = 200;
const MAX_CONSOLIDATE_TARGETS = 10;
const MAX_CONSOLIDATE_SOURCE_IDS = 50;

const writeMergeSchema = Type.Object({
	kind: memoryKindSchema,
	summary: Type.String({ description: "Merged memory statement" }),
	detail: Type.Optional(Type.String({ description: "Optional merged supporting detail" })),
	supersedes: Type.Array(Type.String(), { description: "Ids of the active memories being merged (at least one, at most 10)" }),
	scene: Type.Optional(Type.String({ description: "Optional merged theme name" })),
});

const consolidateFinishSchema = Type.Object({});

interface ConsolidateState {
	active: Map<string, MemoryRecord>;
	merges: number;
	finished: boolean;
}

export interface WriteMergeDeps {
	dir: string;
	state: ConsolidateState;
}

export function createWriteMergeTool(deps: WriteMergeDeps): AgentTool<typeof writeMergeSchema, { ok: boolean; error?: string }> {
	return {
		name: "write_merge",
		label: "Write Merge",
		description: "Merge a group of duplicate or fragmentary active memories into one new record that supersedes them.",
		parameters: writeMergeSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `write_merge rejected: ${message}` }], details: { ok: false, error: message } });
			const summary = params.summary.trim();
			if (!summary) return reject("summary is required");
			const supersedes = [...new Set(params.supersedes)];
			if (supersedes.length === 0) return reject("supersedes must list at least one active memory id");
			if (supersedes.length > MAX_CONSOLIDATE_TARGETS) return reject(`at most ${MAX_CONSOLIDATE_TARGETS} records can be merged at once`);
			for (const id of supersedes) {
				if (!deps.state.active.has(id)) return reject(`"${id}" is not an active memory (already merged or unknown)`);
			}
			const targets = supersedes.map((id) => deps.state.active.get(id)!);
			const rawIds = [...new Set(targets.flatMap((target) => target.source.rawIds))].slice(0, MAX_CONSOLIDATE_SOURCE_IDS);
			const scene = params.scene?.trim() || (targets.every((target) => target.scene === targets[0].scene) ? targets[0].scene : undefined);
			const detail = params.detail?.trim();
			const record: MemoryRecord = {
				id: `mem-${randomUUID()}`,
				createdAt: Date.now(),
				kind: params.kind,
				source: { rawIds },
				data: { summary, ...(detail ? { detail } : {}) },
				relations: supersedes.map((id) => ({ type: "supersedes" as const, targetId: id })),
				...(scene ? { scene } : {}),
				...(targets.some((target) => target.remember === true) ? { remember: true as const } : {}),
			};
			await appendMemoryLines(deps.dir, [record]);
			for (const id of supersedes) deps.state.active.delete(id);
			deps.state.merges += 1;
			return { content: [{ type: "text", text: `merged ${supersedes.length} memories into ${record.id}` }], details: { ok: true } };
		},
	};
}

function createConsolidateFinishTool(state: ConsolidateState): AgentTool<typeof consolidateFinishSchema, { ok: boolean }> {
	return {
		name: "finish",
		label: "Finish",
		description: "Finish the consolidation pass once every merge worth doing has been written.",
		parameters: consolidateFinishSchema,
		executionMode: "sequential",
		async execute() {
			state.finished = true;
			return { content: [{ type: "text", text: "Consolidation finished." }], details: { ok: true }, terminate: true };
		},
	};
}

function consolidatePrompt(records: MemoryRecord[], total: number): string {
	const lines = ["Active memories (newest first):"];
	lines.push(
		records
			.map(
				(record) =>
					`- [${record.id}] ${record.kind}${record.scene ? ` (scene: ${record.scene})` : ""}: ${record.data.summary}${record.data.detail ? `\n  ${record.data.detail.slice(0, 400)}` : ""}`,
			)
			.join("\n"),
	);
	if (total > records.length) lines.push("", `(${total - records.length} older memories were not included in this pass.)`);
	lines.push("", "Merge duplicates or fragments with write_merge, then call finish. If nothing should be merged, call finish directly.");
	return lines.join("\n");
}

export interface ConsolidateMemoryOptions {
	dir: string;
	model: Model<any>;
	signal?: AbortSignal;
	logRun?: NonNullable<OrganizeMemoryOptions["logRun"]>;
}

export async function consolidateMemory(opts: ConsolidateMemoryOptions): Promise<number> {
	await ensureMemoryFile(opts.dir);
	const lines = await readMemoryLines(opts.dir);
	const records = queryMemory(lines, { limit: MAX_CONSOLIDATE_RECORDS });
	if (records.length < 2) return 0;
	const activeTotal = queryMemory(lines, { limit: Number.MAX_SAFE_INTEGER }).length;
	const model = opts.model;
	const state: ConsolidateState = { active: new Map(records.map((record) => [record.id, record])), merges: 0, finished: false };

	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	const trajectory: MemoryTrajectoryAttempt[] = [];
	const usage = emptyMemoryUsage();
	const logStart = opts.logRun?.start;
	const logEnd = opts.logRun?.end;
	let attempts = 0;
	let added = 0;

	if (logStart) {
		try {
			await logStart({ runId, stage: "consolidate", startedAt });
		} catch (error) {
			console.error("consolidate run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunEndReason, error?: string) {
		const endedAt = Date.now();
		if (logEnd) {
			try {
				await logEnd({ runId, stage: "consolidate", startedAt, endedAt, reason, added });
			} catch (logError) {
				console.error("consolidate run end log failed:", logError);
			}
		}
		try {
			await appendMemoryRun(opts.dir, {
				runId,
				stage: "consolidate",
				model: `${model.provider}/${model.id ?? "default"}`,
				startedAt,
				endedAt,
				durationMs: endedAt - startedAt,
				reason,
				attempts,
				added,
				targetRawId: null,
				cursorRawId: null,
				...(error ? { error } : {}),
				...(usage.calls ? { usage } : {}),
				systemPrompt: CONSOLIDATE_WORKFLOW,
				trajectory,
			});
		} catch (runError) {
			console.error("consolidate run trajectory append failed:", runError);
		}
	}

	try {
		while (attempts < MAX_CONSOLIDATE_ATTEMPTS && !state.finished) {
			if (opts.signal?.aborted) break;
			const agent = new Agent({ streamFn: STREAM_FN, convertToLlm });
			agent.state.model = model;
			agent.state.systemPrompt = CONSOLIDATE_WORKFLOW;
			agent.state.tools = [createWriteMergeTool({ dir: opts.dir, state }), createConsolidateFinishTool(state)];
			const onAbort = () => agent.abort();
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			try {
				await agent.prompt(consolidatePrompt([...state.active.values()], activeTotal));
				await agent.waitForIdle();
			} finally {
				opts.signal?.removeEventListener("abort", onAbort);
			}
			if (opts.signal?.aborted) break;
			attempts += 1;
			trajectory.push({ attempt: attempts, messages: snapshotTrajectory(agent.state.messages) });
			addMessageUsage(usage, agent.state.messages);
		}
		added = state.merges;
		await endRun(opts.signal?.aborted ? "interrupted" : state.finished ? "completed" : "unfinished");
		return added;
	} catch (error) {
		added = state.merges;
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	}
}

const CONSOLIDATE_WORKFLOW = `You consolidate this partner's long-term memories.\n\nMerge groups that state the same fact, or fragments that belong together, into one record:\n- Call write_merge with the merged kind/summary/detail and list the ids of the records being replaced in supersedes.\n- Preserve all distinct information from the merged records; never invent anything.\n- Only merge true duplicates or fragments of one fact — never merge merely related items.\n- A record can be superseded at most once; previously merged ids are no longer active.\n- If nothing should be merged, call finish without writing.`;
