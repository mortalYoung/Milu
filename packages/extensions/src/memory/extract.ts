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
import { trajectoryRecordsOf } from "./trace.ts";

const MEMORY_WORKFLOW = `You are running a memory extraction loop for this partner.

Workflow:
1. read_raw shows raw conversation entries; each line starts with the entry id and its timestamp.
2. Call memory op "read" when you need to know what is already stored (structured filters: subject / predicate / kinds); one call covers several entities — separate them with | (soccer|duathlon|harmonica).
3. Write every durable atom with memory op "write", in batches of up to 100 atoms per call.
   - rawIds must be ids you actually read.
   - event / update need eventAt (or at) taken from the source entry timestamp, never "now".
4. Stop once every atom you found is written. The engine then checks coverage: every entry you read must either back an atom or be dismissed with skip, and a thin pass is re-scanned once.

Kinds (6):
- attribute: stable, no occurrence time, written as subject + predicate + value (e.g. degree, commute minutes, model of a device).
- event: something that happened at a time and can repeat or be counted. Carries eventAt; items[] for the objects involved (each object one item, with its type); value for a number; outcome only when the episode ended as a decision or an issue.
- reference: something the partner will come back to — a list, address, parameter, plan, or a piece you produced on request (script, article, report, essay, code). provider is user / assistant / external.
- preference: "I prefer / I avoid", with direction and scope (the situation it applies to).
- instruction: a long-term requirement the user sets for your behaviour. appliesTo names the scope ("milu-repo", "global").
- update: a new value for an existing subject + predicate. Carries old, next, at and supersedes (the id of the record it replaces).

Boundary rules (REQUIRED):
- One fact never becomes two kinds. If it is stable and timeless it is an attribute, not an event.
- A user question is not an event by itself; only an episode with something that can be counted or timed is.
  "User asked where they went" / "User wanted to know how many X" records the conversation, not the user's life — the question is already in the transcript. Skip it.
- When a new value replaces an old one, write update (not event) and point supersedes at the old record.
- Do not write unsolicited narration, generic advice, or the request itself as an atom.
- An atom describes and points; it never carries the text. A long piece stays in the transcript — name it, list what it contains in items, and let rawIds lead back to the words.
- Read before writing: if an atom already exists, skip it. Writing the same statement twice is rejected.`;

const MAX_READ_ENTRIES = 60;
const MAX_WRITE_BATCH = 100;

const memoryKindSchema = Type.Union([
	Type.Literal("attribute"),
	Type.Literal("event"),
	Type.Literal("reference"),
	Type.Literal("preference"),
	Type.Literal("instruction"),
	Type.Literal("update"),
]);

const memoryQueryFields = {
	query: Type.Optional(
		Type.String({
			description:
				"read: terms split on spaces and punctuation match as literal substrings of summary/detail, and the whole query is also tried as a regex. Separate alternatives with | to check several entities in one call (soccer|duathlon|harmonica). If nothing matches, retry with one distinctive word, the same word in the source language, or drop to kinds alone",
		}),
	),
	kinds: Type.Optional(Type.Array(memoryKindSchema, { description: "read: only return these kinds" })),
	subject: Type.Optional(Type.String({ description: "read: exact subject filter (case-insensitive); | separates alternatives (a|b|c)" })),
	predicate: Type.Optional(Type.String({ description: "read: exact predicate filter (case-insensitive); | separates alternatives (degree|commute_minutes)" })),
	from: Type.Optional(Type.String({ description: "read: earliest event time, ISO date or timestamp" })),
	to: Type.Optional(Type.String({ description: "read: latest event time, ISO date or timestamp" })),
	limit: Type.Optional(Type.Integer({ description: "read: maximum records to return (default 20)" })),
	offset: Type.Optional(Type.Integer({ description: "read: skip this many records after ranking (use it to page through a large result)" })),
	includeSuperseded: Type.Optional(Type.Boolean({ description: "read: include records replaced by an update (default false)" })),
};

const timeField = (description: string) => Type.Optional(Type.String({ description }));

const memoryItemSchema = Type.Object({
	name: Type.String({ description: "the object, named the way the user names it" }),
	type: Type.Union(
		[
			Type.Literal("possession"),
			Type.Literal("media"),
			Type.Literal("consumable"),
			Type.Literal("experience"),
			Type.Literal("person"),
			Type.Literal("place"),
			Type.Literal("information"),
			Type.Literal("other"),
		],
		{
			description:
				"what the item is, never what happened to it: possession (a thing or entitlement held), media (a titled work), consumable (used up), experience (an occurrence taken part in), person, place, information (knowledge, plans, addresses), other",
		},
	),
	amount: Type.Optional(Type.Number({ description: "counted amount, not money" })),
});

const atomicValue = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);

const memoryAtomSchema = Type.Object({
	kind: memoryKindSchema,
	summary: Type.String({ description: "one-line statement, in the language of the source entries — never translate" }),
	detail: Type.Optional(Type.String({ description: "optional supporting detail" })),
	rawIds: Type.Array(Type.String({ description: "raw entry ids this atom came from (must be read first)" })),
	eventAt: timeField("event: when it happened, taken from the source entry timestamp"),
	at: timeField("update only — when the value changed"),
	subject: Type.Optional(Type.String({ description: "attribute / preference / update — who or what the atom is about" })),
	predicate: Type.Optional(Type.String({ description: "attribute / update — the property, e.g. degree, commute_minutes" })),
	value: Type.Optional(atomicValue),
	old: Type.Optional(atomicValue),
	next: Type.Optional(atomicValue),
	direction: Type.Optional(Type.Union([Type.Literal("prefer"), Type.Literal("avoid")])),
	offset: Type.Optional(Type.Integer({ description: "read with rawIds: skip this many characters into each entry; use it when a reply says the entry continues" })),
	scope: Type.Optional(Type.String({ description: "preference — the situation the preference applies to" })),
	appliesTo: Type.Optional(Type.String({ description: 'instruction — the scope of the rule, e.g. "milu-repo" or "global"' })),
	provider: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("assistant"), Type.Literal("external")])),
	outcome: Type.Optional(Type.Union([Type.Literal("done"), Type.Literal("decision"), Type.Literal("issue")])),
	items: Type.Optional(
		Type.Array(memoryItemSchema, {
			description: "event / reference — the enumerable things: what the event produced, or what a piece contains (characters, places, figures, wardrobe), one item each",
		}),
	),
	supersedes: Type.Optional(Type.String({ description: "update — the id of the record this value replaces" })),
});

export const memorySchema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("write")], {
		description: "read: search this partner's atoms; write: append atoms in one batch",
	}),
	...memoryQueryFields,
	atoms: Type.Optional(Type.Array(memoryAtomSchema, { description: `write: 1–${MAX_WRITE_BATCH} atoms in one call; each is validated on its own` })),
});

export const memoryQuerySchema = Type.Object({
	op: Type.Optional(Type.Literal("read")),
	...memoryQueryFields,
	rawIds: Type.Optional(
		Type.Array(Type.String(), {
			description: "read: fetch these transcript entries verbatim — copy the ids an atom lists under ↳ entries, or ones a scope=entries search returned",
		}),
	),
	scope: Type.Optional(
		Type.Union([Type.Literal("atoms"), Type.Literal("entries")], {
			description: "read: atoms (default) searches stored atoms; entries searches the original transcript, for detail no atom carries",
		}),
	),
});

type MemoryAtom = Static<typeof memoryAtomSchema>;
type MemoryToolParams = Static<typeof memorySchema> | Static<typeof memoryQuerySchema>;

function isWriteCall(params: MemoryToolParams): params is Static<typeof memorySchema> {
	return "op" in params && params.op === "write";
}

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
	if (source >= 0.3 && atom <= 0.05) return "summary must stay in the source language (Chinese here) — do not translate the conversation; rewrite this summary in Chinese";
	if (source <= 0.05 && atom >= 0.2) return "summary must stay in the source language (English here) — do not translate the conversation; rewrite this summary in English";
	return null;
}

export function entryStamp(entry: Entry): string {
	const messageAt = (entry as { message?: { timestamp?: unknown } }).message?.timestamp;
	const at = typeof messageAt === "number" ? messageAt : (entry as { timestamp?: unknown }).timestamp;
	return typeof at === "number" ? new Date(at).toISOString() : "";
}

interface Coverage {
	readonly covered: number;
	readonly uncovered: readonly number[];
	readonly entryRatio: number;
	readonly charRatio: number;
}

function coverageOf(entries: readonly Entry[], upto: number, records: readonly MemoryRecord[], skipped: readonly { from: number; to: number }[]): Coverage {
	const coveredIds = new Set<string>();
	for (const record of records) for (const id of record.source?.rawIds ?? []) coveredIds.add(id);
	const total = Math.max(0, upto + 1);
	let covered = 0;
	let chars = 0;
	let coveredChars = 0;
	const uncovered: number[] = [];
	for (let index = 0; index < total; index += 1) {
		const entry = entries[index]!;
		const text = entryText(entry);
		chars += text.length;
		const verdict = coveredIds.has(entry.id) || skipped.some((range) => index >= range.from && index <= range.to);
		if (verdict) {
			covered += 1;
			coveredChars += text.length;
		} else uncovered.push(index);
	}
	return { covered, uncovered, entryRatio: total > 0 ? covered / total : 1, charRatio: chars > 0 ? coveredChars / chars : 1 };
}

const skipSchema = Type.Object({
	from: Type.String({ description: "first raw id of the range that holds nothing durable" }),
	to: Type.Optional(Type.String({ description: "last raw id of the range; omit when it is a single entry" })),
	reason: Type.String({ description: 'why nothing here belongs in memory, e.g. "small talk" or "the assistant restating the same list"' }),
});

function createReadRawTool(
	entries: readonly Entry[],
	indexById: Map<string, number>,
	progress: { index: number; read: number; next: number },
): AgentTool<typeof readRawSchema, { ok: boolean; error?: string }> {
	return {
		name: "read_raw",
		label: "Read Raw",
		description: "Read raw conversation entries from a starting raw id (inclusive). Always pass the starting id given in the prompt and keep moving forward.",
		parameters: readRawSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const startIndex = indexById.get(params.from);
			if (startIndex !== undefined && startIndex > progress.next) {
				const expectedId = entries[progress.next]?.id ?? params.from;
				return {
					content: [{ type: "text", text: `memory rejected: you would skip ${startIndex - progress.next} unread entries — continue from ${expectedId}` }],
					details: { ok: false, error: "skipped unread entries" },
				};
			}
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
			progress.next = Math.max(progress.next, startIndex + selected.length);
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

const META_EVENT =
	/^(the\s+)?user\s+(asked|asks|wondered|inquires?|inquired|wanted to know|requested)\s+(me|you|the assistant|whether|if|how|what|where|when|who|why|which)\b|^用户(问|询问|想知道|问到)/iu;

export function metaEventProblem(atom: { kind?: MemoryKind; summary: string; items?: readonly unknown[]; value?: unknown; outcome?: unknown }): string | null {
	if (atom.kind !== "event") return null;
	if (atom.items?.length || atom.value !== undefined || atom.outcome !== undefined) return null;
	if (!META_EVENT.test(atom.summary.trim())) return null;
	return "an event records something that happened to the user, not a question they asked — record the fact the question was about, or drop it: the question is already in the transcript";
}

function kindProblem(params: MemoryAtom): string | null {
	const kind = params.kind as MemoryKind | undefined;
	const need = (ok: boolean, field: string, fix: string): string | null => (ok ? null : `${kind} needs ${field} — ${fix}`);
	if (!kind) return "write needs kind — pick attribute / event / preference / reference / instruction / update to match what you read";
	if (kind === "attribute")
		return need(
			Boolean(params.subject && params.predicate && params.value !== undefined),
			"subject, predicate and value",
			'a durable fact reads like {subject: "device", predicate: "os", value: "macOS 15"} — drop the atom if it has no such triple',
		);
	if (kind === "event") {
		if (!params.eventAt) return "event needs eventAt — copy the timestamp of the source entry that records what happened";
		return need(Boolean(params.items?.length || params.value !== undefined), "items[] or a numeric value", "list what the event covered, or give the number it produced");
	}
	if (kind === "preference")
		return need(
			Boolean(params.direction && params.scope),
			"direction and scope",
			'say which way the user leans and where it applies, e.g. direction: "prefers terse replies", scope: "code review"',
		);
	if (kind === "reference") return need(Boolean(params.provider), "provider (user / assistant / external)", "name who holds the thing you are pointing at");
	if (kind === "instruction") return need(Boolean(params.appliesTo), "appliesTo (the scope of the rule)", "say what the rule governs so it is recalled when that work happens");
	if (kind === "update") {
		if (!params.subject || !params.predicate) return "update needs subject and predicate — make them identical to the atom being replaced so the chain matches";
		if (params.old === undefined || params.next === undefined) return "update needs old and next — give the value before and after the change";
		if (!params.at) return "update needs at (when the value changed) — copy the date of the entry where the change happened";
		return need(
			Boolean(params.supersedes),
			"supersedes (the id of the record being replaced)",
			"recall the atom with op read and pass its id, or write a plain attribute when nothing is being replaced",
		);
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
			"Read this partner's atoms. Separate alternatives with | in query / subject / predicate to check several entities in one call (soccer|duathlon). When nothing is stored yet the result says memory is empty — that means there is nothing to dedupe against. Matches are ranked by relevance when a query is given, otherwise newest first (event time); records replaced by an update are hidden unless includeSuperseded is true. Conflicts (same subject+predicate with several values) are reported.",
		parameters: canWrite ? memorySchema : memoryQuerySchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `memory rejected: ${message}` }], details: { ok: false, error: message } });
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });

			if (!isWriteCall(params)) {
				if (!opts.read) return reject("read is not available in this pass — write the atoms you extracted instead");
				const from = parseTime(params.from);
				const to = parseTime(params.to);
				if (params.from && from === null) return reject(`from "${params.from}" is not a date — pass YYYY-MM-DD, a full ISO timestamp, or a 13-digit epoch in ms`);
				if (params.to && to === null) return reject(`to "${params.to}" is not a date — pass YYYY-MM-DD, a full ISO timestamp, or a 13-digit epoch in ms`);
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
				if (page.stored === 0)
					return note(`memory is empty — nothing is stored yet, so there is nothing to dedupe against; write the atoms you found (1–${MAX_WRITE_BATCH} per call).`);
				const tooMany = tooManyMatches(page);
				if (tooMany && (params.offset ?? 0) === 0) return reject(tooMany);
				if (memories.length === 0) return note("No atoms found.");
				return note(memories.map((memory) => format(memory)).join("\n\n"));
			}

			const write = opts.write;
			if (!write) return reject("write is not available in this pass — this tool is read-only here; recall with op read instead");
			const atoms = params.atoms ?? [];
			if (atoms.length === 0) return reject(`write needs atoms[] — one entry per extracted fact, 1–${MAX_WRITE_BATCH} per call`);
			if (atoms.length > MAX_WRITE_BATCH) return reject(`at most ${MAX_WRITE_BATCH} atoms per call (got ${atoms.length}) — split the batch`);

			const accepted: MemoryRecord[] = [];
			const skipped: string[] = [];
			const refused: string[] = [];

			for (const [index, atom] of atoms.entries()) {
				const label = `#${index + 1} ${atom.kind ?? "?"}`;
				const problem = kindProblem(atom);
				if (problem) {
					refused.push(`${label}: ${problem}`);
					continue;
				}
				const meta = metaEventProblem({
					kind: atom.kind as MemoryKind,
					summary: atom.summary,
					...(atom.items ? { items: atom.items } : {}),
					...(atom.value !== undefined ? { value: atom.value } : {}),
					...(atom.outcome ? { outcome: atom.outcome } : {}),
				});
				if (meta) {
					refused.push(`${label}: ${meta}`);
					continue;
				}
				const summary = atom.summary.trim();
				if (!summary) {
					refused.push(`${label}: summary is empty — write one line stating the fact, in the source language`);
					continue;
				}
				const rawIds = atom.rawIds.filter((id) => {
					const entryIndex = write.indexById.get(id);
					return entryIndex !== undefined && entryIndex <= write.readProgress.index;
				});
				if (rawIds.length === 0) {
					refused.push(`${label}: rawIds must reference entries you have already read — copy the [id] of an entry returned by read_raw in this pass`);
					continue;
				}
				const sources = rawIds.map((id) => write.entries[write.indexById.get(id)!]).filter((entry): entry is Entry => entry !== undefined);
				const language = languageProblem(summary, sources);
				if (language) {
					refused.push(`${label}: ${language}`);
					continue;
				}
				const key = dedupeKey({
					kind: atom.kind as MemoryKind,
					summary,
					...(atom.subject ? { subject: atom.subject } : {}),
					...(atom.predicate ? { predicate: atom.predicate } : {}),
					...(atom.value !== undefined ? { value: atom.value as MemoryValue } : {}),
				});
				if (write.seen.has(key)) {
					skipped.push(`${label}: already stored — do not write it twice`);
					continue;
				}
				const candidate = shingles(summary);
				if (write.similar.some((other) => other.kind === atom.kind && jaccard(candidate, other.set) >= NEAR_DUPLICATE)) {
					skipped.push(`${label}: near-duplicate of a stored atom — fold the new detail into that atom with an update instead of adding a second one`);
					continue;
				}
				const eventAt = parseTime(atom.eventAt);
				if (atom.eventAt && eventAt === null) {
					refused.push(`${label}: eventAt "${atom.eventAt}" is not a date — copy the source entry's timestamp as YYYY-MM-DD or a full ISO timestamp`);
					continue;
				}
				const at = parseTime(atom.at);
				if (atom.at && at === null) {
					refused.push(`${label}: at "${atom.at}" is not a date — pass the day the value changed as YYYY-MM-DD`);
					continue;
				}
				if (atom.kind === "update" && !write.activeById.has(atom.supersedes ?? "")) {
					refused.push(
						`${label}: supersedes "${atom.supersedes}" is not an active atom — recall the live id with op read, or write a plain attribute when nothing is being replaced`,
					);
					continue;
				}
				const record: MemoryRecord = {
					id: `mem-${randomUUID()}`,
					createdAt: Date.now(),
					kind: atom.kind as MemoryKind,
					source: { rawIds },
					summary,
					...(atom.detail ? { detail: atom.detail } : {}),
					...(eventAt !== null ? { eventAt } : {}),
					...(at !== null ? { at } : {}),
					...(atom.subject ? { subject: atom.subject } : {}),
					...(atom.predicate ? { predicate: atom.predicate } : {}),
					...(atom.value !== undefined ? { value: atom.value as MemoryValue } : {}),
					...(atom.old !== undefined ? { old: atom.old as MemoryValue } : {}),
					...(atom.next !== undefined ? { next: atom.next as MemoryValue } : {}),
					...(atom.direction ? { direction: atom.direction } : {}),
					...(atom.scope ? { scope: atom.scope } : {}),
					...(atom.appliesTo ? { appliesTo: atom.appliesTo } : {}),
					...(atom.provider ? { provider: atom.provider } : {}),
					...(atom.outcome ? { outcome: atom.outcome } : {}),
					...(atom.items?.length ? { items: atom.items } : {}),
					...(atom.supersedes ? { supersedes: atom.supersedes } : {}),
				};
				accepted.push(record);
				write.seen.add(key);
				write.similar.push({ kind: record.kind, set: candidate });
			}

			if (accepted.length === 0) {
				const reasons = [...skipped, ...refused].slice(0, 6).join("; ");
				return note(`memory: nothing written — ${reasons || "no atoms given"}. Fix the lines above and call write again with only the atoms that pass`);
			}

			await appendMemoryLines(write.dir, accepted);
			for (const record of accepted) {
				write.records.push(record);
				write.activeById.set(record.id, record);
				if (record.kind === "update" && record.supersedes) write.activeById.delete(record.supersedes);
				write.onAdded();
			}
			const summaryParts = [`memory: wrote ${accepted.length} atom(s)`];
			if (skipped.length > 0) summaryParts.push(`skipped ${skipped.length} (${skipped.slice(0, 3).join("; ")})`);
			if (refused.length > 0) summaryParts.push(`rejected ${refused.length} (${refused.slice(0, 3).join("; ")})`);
			return note(summaryParts.join(" · "));
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
const COVERAGE_FLOOR = 0.5;
const COVERAGE_MIN_GAP = 20;
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
	const modelName = `${opts.model.provider}/${opts.model.id ?? "default"}`;
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

	let passRead = { index: -1, read: 0, next: 0 };
	let readEntries = 0;
	let hint = "";
	let retried = false;
	let retryTargets: readonly number[] = [];
	let coverage = { covered: 0, uncovered: [] as readonly number[], entryRatio: 1, charRatio: 1 };
	const skipped: { from: number; to: number; reason: string }[] = [];
	const deadline = startDeadline(opts.signal, STAGE_TIMEOUT_MS);
	try {
		const outcome = await runRalphLoop({
			maxAttempts: MAX_ORGANIZE_ATTEMPTS,
			signal: deadline.signal,
			onProgress: (passes) => {
				void opts.logRun?.trace?.({
					runId,
					stage: "memory",
					model: modelName,
					startedAt,
					endedAt: Date.now(),
					reason: "unfinished",
					records: trajectoryRecordsOf(passes, { runId, startedAt, model: modelName }),
				});
			},
			createPass: () => {
				const startIndex = retryTargets.length > 0 ? Math.min(...retryTargets) : Math.max(0, cursorIndex + 1);
				passRead = { index: -1, read: 0, next: startIndex };
				const seen = new Set(records.map((record) => dedupeKey(record)));
				const similar = records.map((record) => ({ kind: record.kind, set: shingles(record.summary) }));
				const activeById = new Map(activeRecords(records).map((record) => [record.id, record]));
				const skip: AgentTool<typeof skipSchema, { ok: boolean; error?: string }> = {
					name: "skip",
					label: "Skip",
					description: "Dismiss a range of entries that holds nothing durable, so the coverage check stops asking about it.",
					parameters: skipSchema,
					executionMode: "sequential",
					async execute(_toolCallId, params) {
						const from = indexById.get(params.from);
						const to = params.to === undefined ? from : indexById.get(params.to);
						if (from === undefined || to === undefined)
							return { content: [{ type: "text" as const, text: "unknown raw id — copy ids exactly as read_raw printed them" }], details: { ok: false } };
						const [low, high] = from <= to ? [from, to] : [to, from];
						skipped.push({ from: low, to: high, reason: params.reason });
						return { content: [{ type: "text" as const, text: `Noted: entries ${low}–${high} hold nothing durable (${params.reason}).` }], details: { ok: true } };
					},
				};
				const agent = createMemoryAgent(opts.model, opts.streamFn, MEMORY_WORKFLOW, [
					createReadRawTool(entries, indexById, passRead),
					skip,
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
				const gap =
					retryTargets.length > 0
						? `Coverage check: ${retryTargets.length} entries you already read produced nothing. Re-scan them and either write the atoms they justify or dismiss a range with skip. Entries: ${retryTargets
								.slice(0, 20)
								.map((index) => `[${entries[index]!.id}] ${entryText(entries[index]!).replace(/\s+/g, " ").slice(0, 90)}`)
								.join(" | ")}`
						: `There are still some logs waiting to be extracted. Please read from ${entries[startIndex]!.id}. The last raw id to cover is ${targetRawId}.`;
				const body = gap;
				return { agent, prompt: hint ? `${body}\n\n${hint}` : body };
			},
			settlePass: async () => {
				readEntries += passRead.read;
				hint = "";
				const reached = Math.min(targetIndex, Math.max(passRead.index, recordProgressIndex(records, indexById)));
				if (reached > cursorIndex) {
					cursorIndex = reached;
					if (cursorIndex < targetIndex) {
						const rawId = entries[cursorIndex]!.id;
						await appendMemoryLines(opts.dir, [makeCheckpoint(rawId, false)]);
						checkpoints.push(rawId);
						return "advanced";
					}
				} else if (cursorIndex < targetIndex) {
					return "stalled";
				}

				coverage = coverageOf(entries, cursorIndex, records, skipped);
				const thin = coverage.entryRatio < COVERAGE_FLOOR || coverage.charRatio < COVERAGE_FLOOR;
				if (!retried && coverage.uncovered.length >= COVERAGE_MIN_GAP && thin) {
					retried = true;
					retryTargets = coverage.uncovered;
					return "advanced";
				}

				const rawId = entries[cursorIndex]!.id;
				await appendMemoryLines(opts.dir, [makeCheckpoint(rawId, true)]);
				checkpoints.push(rawId);
				return "done";
			},
		});
		attempts = outcome.attempts;
		const endedAt = Date.now();
		const reason = deadline.timedOut() ? "blocked" : outcome.reason;
		await logEnd(reason, endedAt);
		await opts.logRun?.trace?.({
			runId,
			stage: "memory",
			model: modelName,
			startedAt,
			endedAt,
			reason,
			records: trajectoryRecordsOf(outcome.passes, { runId, startedAt, model: modelName }),
		});
		await appendMemoryRun(opts.dir, {
			runId,
			stage: "memory",
			model: modelName,
			startedAt,
			endedAt,
			durationMs: endedAt - startedAt,
			reason,
			attempts,
			added,
			targetRawId,
			cursorRawId: cursorIndex >= 0 ? entries[cursorIndex]!.id : null,
			readEntries,
			coveredEntries: coverage.covered,
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
