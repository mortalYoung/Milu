import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type AgentMessage, type AgentTool, type Model, type Static, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
import { atomCursor, createReadAtomsTool } from "./atom-tool.ts";
import { startDeadline } from "./deadline.ts";
import { runRalphLoop } from "./loop.ts";
import { appendMemoryRun, atomsAfter, ensureMemoryDir, isoDay, memoryDir, type MemoryRunLog, type MemoryRunReason, readMemoryLines, readWatermarks } from "./store.ts";
import { trajectoryRecordsOf } from "./trace.ts";

export const sopDirectory = (dir: string) => join(memoryDir(dir), "sops");
export const MAX_SOPS = 20;
const RUN_ATOMS = 60;
const PASS_ATOMS = 30;
export const MAX_SOP_TITLE = 24;
export const MAX_SOP_WHEN = 80;
export const MAX_SOP_PITFALLS = 5;
export const MAX_SOP_EVIDENCE = 30;
export const SOP_READ_LIMIT = 120;
const STAGE_TIMEOUT_MS = 3 * 60_000;

const SECTIONS = ["Purpose", "When", "Procedure", "Checklist", "Pitfalls"] as const;

export interface SopEvidence {
	readonly atomId: string;
	readonly date: string;
	readonly note: string;
}

export interface SopMeta {
	readonly id: string;
	readonly title: string;
	readonly updated: string;
	readonly rev: number;
	readonly confidence: number;
	readonly throughAtom: string;
	readonly sources: readonly string[];
	readonly evidence: readonly SopEvidence[];
}

export interface SopDoc {
	readonly meta: SopMeta;
	readonly header: string;
	readonly body: string;
	readonly content: string;
}

export interface SopIndexEntry {
	readonly id: string;
	readonly title: string;
	readonly when: string;
	readonly updated: string;
	readonly rev: number;
}

const ID_PATTERN = /^sop-[a-z0-9][a-z0-9-]*$/;

function headerBlock(content: string): { header: string; body: string } | null {
	const text = content.replace(/\r\n/g, "\n").trim();
	if (!text.startsWith("---\n")) return null;
	const end = text.indexOf("\n---", 4);
	if (end < 0) return null;
	const header = text.slice(4, end);
	const body = text.slice(end + 4).replace(/^\n+/, "");
	return { header, body };
}

function headerValue(header: string, key: string): string | null {
	const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(header);
	if (!match) return null;
	return (match[1] ?? "").trim();
}

function headerList(header: string, key: string): string[] | null {
	const value = headerValue(header, key);
	if (value === null) return null;
	if (!value.startsWith("[") || !value.endsWith("]")) return null;
	const inner = value.slice(1, -1).trim();
	if (inner === "") return [];
	return inner.split(",").map((item) => item.trim().replace(/^["']|["']$/g, ""));
}

function evidenceList(header: string): SopEvidence[] | null {
	const lines = header.split("\n");
	const start = lines.findIndex((line) => line.trim() === "evidence:");
	if (start < 0) return null;
	const out: SopEvidence[] = [];
	for (const line of lines.slice(start + 1)) {
		if (!line.startsWith("  - ")) break;
		const [atomId = "", date = "", ...rest] = line
			.slice(4)
			.split("|")
			.map((part) => part.trim());
		if (!atomId) return null;
		out.push({ atomId, date, note: rest.join(" | ") });
	}
	return out;
}

export function sectionBody(body: string, section: string): string {
	const pattern = new RegExp(`^## ${section}\\n`, "m");
	const match = pattern.exec(body);
	if (!match) return "";
	const rest = body.slice(match.index + match[0].length);
	const next = /\n## /.exec(rest);
	return (next ? rest.slice(0, next.index) : rest).trim();
}

export function parseSop(content: string): SopDoc | { problem: string } {
	const parts = headerBlock(content);
	if (!parts)
		return { problem: "missing YAML header — the document must open with a --- line and close the header with another --- before the body; write the whole file, not a diff" };
	const { header, body } = parts;
	const id = headerValue(header, "id") ?? "";
	const title = headerValue(header, "title") ?? "";
	const updated = headerValue(header, "updated") ?? "";
	const rev = Number(headerValue(header, "rev") ?? "");
	const confidence = Number(headerValue(header, "confidence") ?? "");
	const throughAtom = headerValue(header, "throughAtom") ?? "";
	const sources = headerList(header, "sources");
	const evidence = evidenceList(header);
	if (!ID_PATTERN.test(id))
		return { problem: 'header field id is missing or not "sop-<kebab-case>" — copy the existing id (e.g. id: sop-weekly-report-aggregation) or coin a new kebab-case one' };
	if (!title) return { problem: `header field title is missing — add one line, at most ${MAX_SOP_TITLE} characters, naming the task this SOP covers` };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) return { problem: "header field updated must be YYYY-MM-DD — write the day you are rewriting it, e.g. updated: 2026-11-16" };
	if (!Number.isFinite(rev) || rev < 1)
		return { problem: "header field rev must be a positive integer — copy the current rev and add 1 (rev: 3 when the stored document is rev: 2); use 1 for a new SOP" };
	if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
		return { problem: "header field confidence must be between 0 and 1 — e.g. confidence: 0.85, higher when more atoms back the document" };
	if (!throughAtom) return { problem: "header field throughAtom is missing — set it to the newest atom id whose content this document already reflects" };
	if (sources === null) return { problem: "header field sources must be a list, e.g. sources: [mem-1, mem-2] — and every id there must also appear on the body line it supports" };
	if (evidence === null) return { problem: "header field evidence must be a list of `- <atomId> | <YYYY-MM-DD> | <one line>`, one entry per atom the body cites" };
	return {
		meta: { id, title, updated, rev, confidence, throughAtom, sources, evidence },
		header,
		body: body.trim(),
		content: content.trim(),
	};
}

export function composeSop(meta: SopMeta, body: string): string {
	const evidence = meta.evidence.map((item) => `  - ${item.atomId} | ${item.date} | ${item.note}`).join("\n");
	return [
		"---",
		`id: ${meta.id}`,
		`title: ${meta.title}`,
		`updated: ${meta.updated}`,
		`rev: ${meta.rev}`,
		`confidence: ${meta.confidence}`,
		`throughAtom: ${meta.throughAtom}`,
		`sources: [${meta.sources.join(", ")}]`,
		"evidence:",
		evidence,
		"---",
		"",
		body.trim(),
		"",
	].join("\n");
}

export function validateSopBody(body: string, evidenceIds: ReadonlySet<string>): string | null {
	const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => (match[1] ?? "").trim());
	if (headings.length !== SECTIONS.length || headings.some((heading, index) => heading !== SECTIONS[index])) {
		return `body sections must be exactly ${SECTIONS.map((section) => `## ${section}`).join(", ")} in this order (found: ${headings.join(", ") || "none"}) — rewrite the body with those five headings and nothing else`;
	}
	const when = sectionBody(body, "When")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (when.length === 0)
		return "the When section needs one sentence describing when to use this SOP — open it with a single line stating the request that should trigger this document";
	const whenLine = when[0]!;
	if (whenLine.length > MAX_SOP_WHEN)
		return `the When sentence is ${whenLine.length} characters (max ${MAX_SOP_WHEN}) — cut it to one line that names the trigger, and move the detail into Procedure`;
	const steps = sectionBody(body, "Procedure")
		.split("\n")
		.filter((line) => /^\d+\.\s/.test(line.trim()));
	if (steps.length < 2) return "Procedure needs at least two numbered steps (1. … 2. …) — write them as an ordered list with one action per line";
	const pitfalls = sectionBody(body, "Pitfalls")
		.split("\n")
		.filter((line) => line.trim().startsWith("- "));
	if (pitfalls.length > MAX_SOP_PITFALLS)
		return `Pitfalls has ${pitfalls.length} entries (max ${MAX_SOP_PITFALLS}) — keep the costliest ones and fold the rest into the Procedure step they belong to`;
	const cited = (line: string): readonly string[] => [...new Set([...line.matchAll(/mem-[0-9a-z-]{3,}/gi)].map((match) => match[0]))];
	const untraced = [...steps, ...pitfalls].filter((line) => !cited(line).some((id) => evidenceIds.has(id)));
	if (untraced.length > 0) {
		const first = (untraced[0] ?? "").trim();
		const missing = cited(first).filter((id) => !evidenceIds.has(id));
		const room = MAX_SOP_EVIDENCE - evidenceIds.size;
		const why = missing.length === 0 ? "cites no atom at all" : `cites ${missing.slice(0, 2).join(", ")}, which evidence does not list`;
		const spare =
			room > 0
				? `evidence has ${room} slot(s) left of ${MAX_SOP_EVIDENCE}`
				: `evidence is already at its ${MAX_SOP_EVIDENCE}-entry cap, so merge or drop lines instead of adding ids`;
		return `${untraced.length} Procedure step(s)/Pitfalls bullet(s) rest on no listed atom — the first one (${first.slice(0, 60)}) ${why}. Fix it by adding that id to evidence (${spare}) or by merging/dropping the line; every step must carry a "(mem-…)" that evidence backs`;
	}
	return null;
}

export function validateSop(content: string): string | null {
	const parsed = parseSop(content);
	if ("problem" in parsed) return parsed.problem;
	const { meta, body } = parsed;
	if (meta.title.length > MAX_SOP_TITLE)
		return `title is ${meta.title.length} characters (max ${MAX_SOP_TITLE}) — shorten the title itself, do not move the extra words into the When line`;
	if (meta.evidence.length === 0)
		return "evidence must list at least one atom — copy the id of an atom that justifies this document, in the form `- mem-… | YYYY-MM-DD | the line it supports`";
	if (meta.evidence.length > MAX_SOP_EVIDENCE)
		return `evidence has ${meta.evidence.length} entries (max ${MAX_SOP_EVIDENCE}) — keep one entry per atom the body actually cites and merge steps that rest on the same atoms until the list fits`;
	return validateSopBody(body, new Set(meta.evidence.map((item) => item.atomId)));
}

export async function sopSignature(dir: string): Promise<string> {
	let names: string[];
	try {
		names = await readdir(sopDirectory(dir));
	} catch {
		return "none";
	}
	const parts: string[] = [];
	for (const name of names.sort()) {
		if (!name.endsWith(".md")) continue;
		try {
			const info = await stat(join(sopDirectory(dir), name));
			parts.push(`${name}:${info.mtimeMs}:${info.size}`);
		} catch {}
	}
	return parts.join("|");
}

export async function readSopDocs(dir: string): Promise<SopDoc[]> {
	let names: string[];
	try {
		names = await readdir(sopDirectory(dir));
	} catch {
		return [];
	}
	const docs: SopDoc[] = [];
	for (const name of names.sort()) {
		if (!name.endsWith(".md")) continue;
		try {
			const content = await readFile(join(sopDirectory(dir), name), "utf8");
			const parsed = parseSop(content);
			if ("problem" in parsed) continue;
			docs.push(parsed);
		} catch {}
	}
	return docs;
}

export async function writeSopDoc(dir: string, content: string): Promise<SopDoc> {
	const parsed = parseSop(content);
	if ("problem" in parsed) throw new Error(parsed.problem);
	if (!(await ensureMemoryDir(dir))) throw new Error("memory directory is not available");
	await mkdir(sopDirectory(dir), { recursive: true });
	await writeFile(join(sopDirectory(dir), `${parsed.meta.id}.md`), `${parsed.content}\n`, "utf8");
	return parsed;
}

export async function deleteSopDoc(dir: string, id: string): Promise<void> {
	if (!ID_PATTERN.test(id)) return;
	await rm(join(sopDirectory(dir), `${id}.md`), { force: true });
}

export async function sopIndex(dir: string): Promise<SopIndexEntry[]> {
	const docs = await readSopDocs(dir);
	return docs
		.map((doc) => ({
			id: doc.meta.id,
			title: doc.meta.title,
			when: sectionBody(doc.body, "When").split("\n")[0]?.trim() ?? "",
			updated: doc.meta.updated,
			rev: doc.meta.rev,
		}))
		.sort((left, right) => (left.updated < right.updated ? 1 : left.updated > right.updated ? -1 : 0));
}

export interface SopReminder {
	readonly text: string;
	readonly digest: string;
}

function digestOf(seed: string): string {
	let hash = 0;
	for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
	return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 12);
}

export function sopIndexReminder(entries: readonly SopIndexEntry[]): SopReminder | null {
	if (entries.length === 0) return null;
	const lines = entries.slice(0, MAX_SOPS).map((entry) => `- ${entry.id} · ${entry.title} — ${entry.when}`);
	const digest = digestOf(entries.map((entry) => `${entry.id}\u0000${entry.title}\u0000${entry.when}\u0000${entry.updated}`).join("\n"));
	return {
		text: ["<system_reminder>", `SOPs available (n=${entries.length}): call sop({op:"read", id:"…"}) before starting one of these tasks.`, ...lines, "</system_reminder>"].join(
			"\n",
		),
		digest,
	};
}

export interface SopChange {
	readonly op: "created" | "updated" | "merged";
	readonly id: string;
	readonly title: string;
	readonly at: number;
}

export function sopUpdateReminder(changes: readonly SopChange[]): SopReminder | null {
	if (changes.length === 0) return null;
	const lines = changes.map((change) => `- ${change.op} · ${change.id} · ${change.title} — ${isoDay(change.at)}`);
	const digest = digestOf(changes.map((change) => `${change.op}:${change.id}:${change.at}`).join("\n"));
	return {
		text: ["<system_reminder>", `SOP update context (${changes.length}): these were just written — read before acting.`, ...lines, "</system_reminder>"].join("\n"),
		digest,
	};
}

export function pageSop(body: string, offset: number | undefined, limit: number | undefined): string {
	const lines = body.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	const start = offset ? Math.max(0, Math.trunc(offset) - 1) : 0;
	if (start >= lines.length) throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`);
	const count = limit === undefined ? SOP_READ_LIMIT : Math.max(1, Math.trunc(limit));
	const end = Math.min(start + count, lines.length);
	let text = lines.slice(start, end).join("\n");
	if (end < lines.length) text += `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`;
	return text;
}

export const sopReadSchema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("read_metadata")], {
		description: "list: every SOP as one line; read: the body of one SOP, paged by line; read_metadata: only the YAML header of one SOP",
	}),
	query: Type.Optional(Type.String({ description: "list: case-insensitive match against id, title and the When sentence" })),
	id: Type.Optional(Type.String({ description: "read / read_metadata: the SOP id, e.g. sop-release" })),
	offset: Type.Optional(Type.Integer({ description: "read: 1-indexed first line to return (default 1)" })),
	limit: Type.Optional(Type.Integer({ description: `read: how many lines to return (default ${SOP_READ_LIMIT})` })),
});

export type SopReadParams = Static<typeof sopReadSchema>;

export function readSopOp(docs: readonly SopDoc[], params: SopReadParams): string {
	const id = params.id?.trim() ?? "";
	if (params.op === "list") {
		const query = params.query?.trim().toLowerCase();
		const selected = docs.filter((doc) => {
			if (!query) return true;
			const when = sectionBody(doc.body, "When").split("\n")[0] ?? "";
			return `${doc.meta.id}\n${doc.meta.title}\n${when}`.toLowerCase().includes(query);
		});
		if (selected.length === 0) return query ? `No SOP matches "${params.query}".` : "No SOPs yet.";
		return selected
			.slice(0, MAX_SOPS)
			.map((doc) => `- ${doc.meta.id} · ${doc.meta.title} — ${sectionBody(doc.body, "When").split("\n")[0]?.trim() ?? ""}`)
			.join("\n");
	}
	if (docs.length === 0) return "No SOPs yet — nothing has been distilled for this partner, so there is no id to read; write the first one once a task recurs.";
	if (id === "") return 'read needs an id — call sop with op "list" to see the available ones, or pass the id you were given';
	const doc = docs.find((candidate) => candidate.meta.id === id);
	if (!doc) {
		const near = docs
			.map((candidate) => candidate.meta.id)
			.filter((candidate) => candidate.includes(id) || id.includes(candidate))
			.slice(0, 3);
		return `Unknown SOP "${id}".${near.length ? ` Closest: ${near.join(", ")}.` : ' Call sop with op "list" to see the available ids.'}`;
	}
	if (params.op === "read_metadata") return `---\n${doc.header}\n---`;
	return pageSop(doc.body, params.offset, params.limit);
}

const sopEvidenceSchema = Type.Object({
	atomId: Type.String({ description: "the atom id, exactly as it appears in the batch" }),
	date: Type.String({ description: "YYYY-MM-DD from the atom's own time" }),
	note: Type.String({ description: "the one line in the body this atom supports" }),
});

const sopWriteSchema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("read_metadata"), Type.Literal("write")], {
		description: "read / read_metadata: inspect an existing SOP; write: the five-section body plus its header fields",
	}),
	id: Type.Optional(Type.String({ description: "read / read_metadata / write: the SOP id, sop-<kebab-case>" })),
	offset: Type.Optional(Type.Integer({ description: "read: 1-indexed first line (default 1)" })),
	limit: Type.Optional(Type.Integer({ description: "read: how many lines (default 120)" })),
	content: Type.Optional(Type.String({ description: 'write: the body only — the five sections starting with "## Purpose", no YAML header' })),
	title: Type.Optional(Type.String({ description: `write: header title, at most ${MAX_SOP_TITLE} characters; omit to keep the stored one` })),
	confidence: Type.Optional(Type.Number({ description: "write: header confidence 0..1, higher when more atoms back the document; omit to keep the stored one" })),
	rev: Type.Optional(Type.Integer({ description: "write: header rev; omit to use the stored rev + 1" })),
	updated: Type.Optional(Type.String({ description: "write: header updated, YYYY-MM-DD; omit for today" })),
	throughAtom: Type.Optional(Type.String({ description: "write: header throughAtom — the newest atom this document reflects; omit to use the last evidence atom" })),
	sources: Type.Optional(Type.Array(Type.String({ description: "write: header sources; omit to use the evidence atom ids" }))),
	evidence: Type.Optional(
		Type.Array(sopEvidenceSchema, { description: "write: header evidence — one entry per atom the body cites; every numbered step and Pitfalls bullet must cite one of them" }),
	),
	consumed: Type.Optional(Type.Array(Type.String({ description: "write: ids of the batch atoms this write actually incorporated" }))),
	dropped: Type.Optional(Type.Array(Type.String({ description: "write: ids of batch atoms that do not belong in any SOP" }))),
	mergedFrom: Type.Optional(Type.Array(Type.String({ description: "write: ids of SOPs this document absorbs; they are deleted in the same run" }))),
});

const finishSchema = Type.Object({});

const noopSchema = Type.Object({ consumed: Type.Array(Type.String()), dropped: Type.Optional(Type.Array(Type.String())) });

function sopWorkflow(limit: number): string {
	return `You maintain long-lived SOP documents distilled from this partner's atomic memories.

A document is exactly five sections in this order, sent in content; the header travels as separate parameters.
${SECTIONS.map((section) => `## ${section}`).join("\n")}

Header parameters:
- id: sop-<kebab-case> — required; copy the stored id when updating.
- title: at most ${MAX_SOP_TITLE} characters — required for a new SOP, defaults to the stored title when updating.
- evidence: one entry per atom the body cites — { atomId, date, note }. Required.
- confidence (0..1), rev, updated, throughAtom, sources — optional; the engine fills rev + 1, today, the last evidence atom and the evidence ids.

Rules:
- Procedure is a numbered list with at least two steps; write decision points as "若 … 则 …" and checkpoints as "确认 …".
- Every numbered step and every Pitfalls bullet ends with the (mem-…) it rests on, and that id must be in evidence. A step that no atom backs is a step you invented — merge it into the one it continues, or drop it.
- Pitfalls: at most ${MAX_SOP_PITFALLS} bullets. evidence: at most ${MAX_SOP_EVIDENCE} entries.
- Every id you list in sources or evidence must also appear in the body, on the line it supports. Never invent atoms.
- At most ${limit} SOPs may exist. When the limit is reached you MUST merge: write one document that absorbs the others and list their ids in mergedFrom.
- Prefer updating an existing SOP over creating a new one; create only when no existing one fits.
- The engine rejects a write that breaks the shape and tells you why; fix it and write again.
- Atoms that belong to no SOP (one-off events, project rules) go into dropped.`;
}

export interface SopOrganizeOptions {
	readonly dir: string;
	readonly model: Model<any>;
	readonly streamFn: StreamFn;
	readonly signal?: AbortSignal;
	readonly maxSops?: number;
	readonly logRun?: MemoryRunLog;
}

export interface SopOrganizeResult {
	readonly added: number;
	readonly changes: readonly SopChange[];
	readonly through?: string;
}

export async function organizeSops(opts: SopOrganizeOptions): Promise<SopOrganizeResult> {
	const lines = await readMemoryLines(opts.dir);
	const watermarks = await readWatermarks(opts.dir);
	const fresh = atomsAfter(lines, watermarks.sop);
	const pending = fresh.filter((atom) => atom.kind === "event").slice(0, RUN_ATOMS);
	// 没有 event 可做，但确实有新原子：把水位推过去，否则 _stages 每轮都会重扫
	if (pending.length === 0) return { added: 0, changes: [], ...(fresh.length > 0 ? { through: fresh.at(-1)!.id } : {}) };
	const cursor = atomCursor();

	const limit = opts.maxSops && opts.maxSops > 0 ? opts.maxSops : MAX_SOPS;
	const docs = await readSopDocs(opts.dir);
	const batch = new Map(pending.map((atom) => [atom.id, atom]));
	const state = { changes: [] as SopChange[], consumed: new Set<string>(), dropped: new Set<string>(), writes: 0 };
	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	const modelName = `${opts.model.provider}/${opts.model.id ?? "default"}`;
	let attempts = 0;
	let through: string | null = null;

	if (opts.logRun) {
		try {
			await opts.logRun.start({ runId, stage: "sop", startedAt });
		} catch (error) {
			console.error("sop run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunReason, error?: string, passes?: readonly (readonly AgentMessage[])[]): Promise<void> {
		const endedAt = Date.now();
		try {
			await opts.logRun?.end({ runId, stage: "sop", startedAt, endedAt, reason, added: state.changes.length });
		} catch (logError) {
			console.error("sop run end log failed:", logError);
		}
		if (passes) {
			await opts.logRun?.trace?.({
				runId,
				stage: "sop",
				model: modelName,
				startedAt,
				endedAt,
				reason,
				records: trajectoryRecordsOf(passes, { runId, startedAt, model: modelName }),
			});
		}
		await appendMemoryRun(opts.dir, {
			runId,
			stage: "sop",
			model: modelName,
			startedAt,
			endedAt,
			durationMs: endedAt - startedAt,
			reason,
			attempts,
			added: state.changes.length,
			targetRawId: null,
			cursorRawId: null,
			...(through ? { throughAtomId: through } : {}),
			...(error ? { error } : {}),
		});
	}

	let rejections = 0;
	const tool: AgentTool<typeof sopWriteSchema, { ok: boolean; error?: string }> = {
		name: "sop",
		label: "SOP",
		description: [
			"Read an existing SOP or write one: content carries the five sections, the header travels as id / title / evidence plus optional confidence, rev, updated, throughAtom, sources, and the engine composes the YAML front matter.",
			"Every numbered step and every Pitfalls bullet ends with the (mem-…) it rests on, and that id must be listed in evidence. e.g.:",
			"",
			"## Procedure",
			"1. 先确认主题、形式与媒介里哪一项被指定 (mem-8f2a1c04, 2026-01-15)",
			"2. 按指定形式给出三段结构 (mem-3b7d9e21, 2026-01-15)",
			"",
			"## Pitfalls",
			"- 形式未指定时直接按长文写，返工一次 (mem-5c1a8d33, 2026-01-15)",
		].join("\n"),
		parameters: sopWriteSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => {
				rejections += 1;
				return {
					content: [{ type: "text" as const, text: `sop rejected: ${message}${rejections >= 10 ? " — stopping this pass; nothing was written" : ""}` }],
					details: { ok: false, error: message },
					...(rejections >= 10 ? { terminate: true } : {}),
				};
			};
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });
			if (params.op !== "write") {
				const current = await readSopDocs(opts.dir);
				return note(readSopOp(current, { op: params.op, id: params.id, offset: params.offset, limit: params.limit }));
			}
			const body = (params.content ?? "").trim();
			if (!body) return reject('write needs content — send the body only: the five sections starting with "## Purpose", no YAML header');
			const id = (params.id ?? "").trim();
			if (!ID_PATTERN.test(id)) return reject('write needs id — "sop-<kebab-case>", copying the stored id when you are updating one');
			const stored = docs.find((doc) => doc.meta.id === id);
			const title = (params.title ?? stored?.meta.title ?? "").trim();
			if (!title) return reject(`write needs title — at most ${MAX_SOP_TITLE} characters naming the task this SOP covers`);
			if (title.length > MAX_SOP_TITLE)
				return reject(`title is ${title.length} characters (max ${MAX_SOP_TITLE}) — shorten the title itself, do not move the extra words into the When line`);
			const confidence = params.confidence ?? stored?.meta.confidence ?? 0.6;
			if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
				return reject("confidence must be between 0 and 1 — e.g. 0.85, higher when more atoms back the document");
			const rev = params.rev ?? (stored?.meta.rev ?? 0) + 1;
			if (rev < 1) return reject("rev must be a positive integer — omit it and the engine uses the stored rev + 1");
			const updated = params.updated ?? new Date().toISOString().slice(0, 10);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) return reject("updated must be YYYY-MM-DD — omit it and the engine stamps today");
			const evidence = (params.evidence ?? []).map((item) => ({ atomId: item.atomId.trim(), date: item.date.trim(), note: item.note.trim() }));
			if (evidence.length === 0) return reject("evidence must list at least one atom — one entry per atom the body cites, with the id exactly as the batch spells it");
			if (evidence.length > MAX_SOP_EVIDENCE)
				return reject(
					`evidence has ${evidence.length} entries (max ${MAX_SOP_EVIDENCE}) — keep one entry per atom the body actually cites and merge steps that rest on the same atoms until the list fits`,
				);
			const bad = evidence.find((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.date));
			if (bad) return reject(`evidence entry ${bad.atomId} has date "${bad.date}" — use YYYY-MM-DD taken from the atom's own time`);
			const bodyProblem = validateSopBody(body, new Set(evidence.map((item) => item.atomId)));
			if (bodyProblem) return reject(bodyProblem);
			const sources = [...new Set([...(params.sources ?? []), ...evidence.map((item) => item.atomId)])];
			const throughAtom = params.throughAtom ?? sources.at(-1) ?? stored?.meta.throughAtom ?? "";
			if (!throughAtom) return reject("throughAtom is missing — name the newest atom this document reflects, or list it in evidence and omit it");
			const carried = new Set([...(stored?.meta.sources ?? []), ...(stored?.meta.evidence.map((item) => item.atomId) ?? [])]);
			const unknown = [...sources, ...evidence.map((item) => item.atomId)].filter((each) => !batch.has(each) && !carried.has(each));
			if (unknown.length > 0)
				return reject(
					`these ids are neither in the batch you were given nor in this SOP's current sources/evidence: ${[...new Set(unknown)].slice(0, 3).join(", ")} — cite only atoms from the "New atoms" list plus the ones this document already carries`,
				);
			const consumed = [...new Set([...(params.consumed ?? []), ...sources])].filter((each) => batch.has(each));
			if (consumed.length === 0)
				return reject(`consumed (or evidence) must list at least one atom id from the batch you were given — copy ids from the "New atoms" list in the prompt`);
			const mergedFrom = [...new Set(params.mergedFrom ?? [])].filter((each) => docs.some((doc) => doc.meta.id === each) && each !== id);
			const existing = stored !== undefined;
			if (!existing && docs.length >= limit)
				return reject(`SOP limit (${limit}) reached — absorb the least useful SOPs into one document and list their ids in mergedFrom instead of adding a new id`);
			const content = composeSop({ id, title, updated, rev, confidence, throughAtom, sources, evidence }, body);
			const parsed = parseSop(content);
			if ("problem" in parsed) return reject(parsed.problem);
			await writeSopDoc(opts.dir, content);
			for (const id of mergedFrom) await deleteSopDoc(opts.dir, id);
			state.changes.push({ op: mergedFrom.length > 0 ? "merged" : existing ? "updated" : "created", id: parsed.meta.id, title: parsed.meta.title, at: Date.now() });
			for (const id of consumed) state.consumed.add(id);
			for (const id of params.dropped ?? []) if (batch.has(id)) state.dropped.add(id);
			state.writes += 1;
			return note(`sop ${parsed.meta.id} written${mergedFrom.length ? ` (merged ${mergedFrom.join(", ")})` : ""}`);
		},
	};

	const finish: AgentTool<typeof finishSchema, { ok: boolean }> = {
		name: "finish",
		label: "Finish",
		description: "Finish this SOP pass once every SOP worth writing has been written.",
		parameters: finishSchema,
		executionMode: "sequential",
		async execute() {
			return { content: [{ type: "text", text: "SOP pass finished." }], details: { ok: true }, terminate: true };
		},
	};

	const noop: AgentTool<typeof noopSchema, { ok: boolean }> = {
		name: "noop",
		label: "No-op",
		description: "Tell the engine that no atom in this batch belongs in an SOP, listing them in consumed/dropped.",
		parameters: noopSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			for (const id of [...params.consumed, ...(params.dropped ?? [])]) if (batch.has(id)) state.dropped.add(id);
			if (params.consumed.length === 0) state.dropped.add(pending[0]!.id);
			return { content: [{ type: "text", text: "Noted; no SOP written." }], details: { ok: true }, terminate: true };
		},
	};

	const prompt = (): string =>
		[
			"A scheduled SOP pass is running.",
			"",
			`Existing SOPs (${docs.length}/${limit}) — call sop with op "read" for the full body:`,
			docs.length ? docs.map((doc) => `- ${doc.meta.id} · ${doc.meta.title} — ${sectionBody(doc.body, "When").split("\n")[0] ?? ""}`).join("\n") : "(none yet)",
			"",
			`${pending.length} event atom(s) arrived since the last pass. Page through them with read_atoms (at most ${PASS_ATOMS} per pass, oldest first); you do not have to read every one — read until you can tell whether a new SOP is justified or an existing one needs a rewrite.`,
			"",
			"Only events reach this stage: preferences, rules and one-off attributes belong to the persona or AGENTS.md, not to an SOP.",
			"",
			"Write the SOPs these atoms justify. If nothing in what you read belongs in an SOP, call noop.",
		].join("\n");

	const deadline = startDeadline(opts.signal, STAGE_TIMEOUT_MS);
	try {
		const outcome = await runRalphLoop({
			maxAttempts: 3,
			signal: deadline.signal,
			onProgress: (passes) => {
				void opts.logRun?.trace?.({
					runId,
					stage: "sop",
					model: modelName,
					startedAt,
					endedAt: Date.now(),
					reason: "unfinished",
					records: trajectoryRecordsOf(passes, { runId, startedAt, model: modelName }),
				});
			},
			createPass: () => ({
				agent: createMemoryAgent(opts.model, opts.streamFn, sopWorkflow(limit), [createReadAtomsTool(pending, cursor, PASS_ATOMS), tool, noop, finish]),
				prompt: prompt(),
			}),
			settlePass: () => {
				const read = cursor.through === null ? -1 : pending.findIndex((atom) => atom.id === cursor.through);
				const written = [...pending].reverse().findIndex((atom) => state.consumed.has(atom.id) || state.dropped.has(atom.id));
				const writtenIndex = written < 0 ? -1 : pending.length - 1 - written;
				const covered = Math.max(read, writtenIndex);
				if (covered < 0) return "stalled";
				return covered >= pending.length - 1 ? "done" : "advanced";
			},
		});
		attempts = outcome.attempts;
		const written = [...pending].reverse().find((atom) => state.consumed.has(atom.id) || state.dropped.has(atom.id));
		through = cursor.through ?? written?.id ?? null;
		await endRun(deadline.timedOut() ? "blocked" : outcome.reason, undefined, outcome.passes);
		return { added: state.changes.length, changes: state.changes, ...(through ? { through } : {}) };
	} catch (error) {
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		deadline.cancel();
	}
}
