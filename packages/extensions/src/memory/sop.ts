import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type AgentTool, type Model, type Static, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
import { runRalphLoop } from "./loop.ts";
import { appendMemoryRun, atomsAfter, ensureMemoryDir, isoDay, memoryDir, type MemoryRunLog, type MemoryRunReason, readMemoryLines, readWatermarks } from "./store.ts";

export const sopDirectory = (dir: string) => join(memoryDir(dir), "sops");
export const MAX_SOPS = 20;
export const MAX_SOP_TITLE = 24;
export const MAX_SOP_WHEN = 80;
export const MAX_SOP_PITFALLS = 5;
export const MAX_SOP_EVIDENCE = 20;
export const SOP_READ_LIMIT = 120;

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
	if (!parts) return { problem: "missing YAML header: the document must start with --- and end the header with ---" };
	const { header, body } = parts;
	const id = headerValue(header, "id") ?? "";
	const title = headerValue(header, "title") ?? "";
	const updated = headerValue(header, "updated") ?? "";
	const rev = Number(headerValue(header, "rev") ?? "");
	const confidence = Number(headerValue(header, "confidence") ?? "");
	const throughAtom = headerValue(header, "throughAtom") ?? "";
	const sources = headerList(header, "sources");
	const evidence = evidenceList(header);
	if (!ID_PATTERN.test(id)) return { problem: 'header field id is missing or not "sop-<kebab-case>"' };
	if (!title) return { problem: "header field title is missing" };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) return { problem: "header field updated must be YYYY-MM-DD" };
	if (!Number.isFinite(rev) || rev < 1) return { problem: "header field rev must be a positive integer" };
	if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { problem: "header field confidence must be between 0 and 1" };
	if (!throughAtom) return { problem: "header field throughAtom is missing" };
	if (sources === null) return { problem: "header field sources must be a list, e.g. sources: [mem-1, mem-2]" };
	if (evidence === null) return { problem: "header field evidence must be a list of `- <atomId> | <YYYY-MM-DD> | <one line>`" };
	return {
		meta: { id, title, updated, rev, confidence, throughAtom, sources, evidence },
		header,
		body: body.trim(),
		content: content.trim(),
	};
}

export function validateSop(content: string): string | null {
	const parsed = parseSop(content);
	if ("problem" in parsed) return parsed.problem;
	const { meta, body } = parsed;
	if (meta.title.length > MAX_SOP_TITLE) return `title is ${meta.title.length} characters (max ${MAX_SOP_TITLE})`;
	const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => (match[1] ?? "").trim());
	if (headings.length !== SECTIONS.length || headings.some((heading, index) => heading !== SECTIONS[index])) {
		return `body sections must be exactly ${SECTIONS.map((section) => `## ${section}`).join(", ")} in this order (found: ${headings.join(", ") || "none"})`;
	}
	const when = sectionBody(body, "When")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (when.length === 0) return "the When section needs one sentence describing when to use this SOP";
	const whenLine = when[0]!;
	if (whenLine.length > MAX_SOP_WHEN) return `the When sentence is ${whenLine.length} characters (max ${MAX_SOP_WHEN})`;
	const steps = sectionBody(body, "Procedure")
		.split("\n")
		.filter((line) => /^\d+\.\s/.test(line.trim()));
	if (steps.length < 2) return "Procedure needs at least two numbered steps (1. … 2. …)";
	const pitfalls = sectionBody(body, "Pitfalls")
		.split("\n")
		.filter((line) => line.trim().startsWith("- "));
	if (pitfalls.length > MAX_SOP_PITFALLS) return `Pitfalls has ${pitfalls.length} entries (max ${MAX_SOP_PITFALLS})`;
	if (meta.evidence.length === 0) return "evidence must list at least one atom";
	if (meta.evidence.length > MAX_SOP_EVIDENCE) return `evidence has ${meta.evidence.length} entries (max ${MAX_SOP_EVIDENCE})`;
	const evidenceIds = new Set(meta.evidence.map((item) => item.atomId));
	const cite = (line: string): boolean => [...line.matchAll(/mem-[0-9a-z-]{3,}/gi)].some((match) => evidenceIds.has(match[0]));
	const untraced = [...steps.filter((step) => !cite(step)).map((step) => step.trim()), ...pitfalls.filter((pitfall) => !cite(pitfall)).map((pitfall) => pitfall.trim())];
	if (untraced.length > 0) {
		return `every Procedure step and Pitfalls bullet must cite an evidence atom id in parentheses, e.g. "… (mem-…)" (missing: ${untraced[0]?.slice(0, 60)})`;
	}
	return null;
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

const sopWriteSchema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("read_metadata"), Type.Literal("write")], {
		description: "read / read_metadata: inspect an existing SOP; write: the complete document, header and body",
	}),
	id: Type.Optional(Type.String({ description: "read / read_metadata: the SOP id" })),
	offset: Type.Optional(Type.Integer({ description: "read: 1-indexed first line (default 1)" })),
	limit: Type.Optional(Type.Integer({ description: "read: how many lines (default 120)" })),
	content: Type.Optional(Type.String({ description: "write: the complete SOP file — YAML header then the five sections" })),
	consumed: Type.Optional(Type.Array(Type.String({ description: "write: ids of the batch atoms this write actually incorporated" }))),
	dropped: Type.Optional(Type.Array(Type.String({ description: "write: ids of batch atoms that do not belong in any SOP" }))),
	mergedFrom: Type.Optional(Type.Array(Type.String({ description: "write: ids of SOPs this document absorbs; they are deleted in the same run" }))),
});

const finishSchema = Type.Object({});

const noopSchema = Type.Object({ consumed: Type.Array(Type.String()), dropped: Type.Optional(Type.Array(Type.String())) });

function sopWorkflow(limit: number): string {
	return `You maintain long-lived SOP documents distilled from this partner's atomic memories.

Every document is one markdown file: a YAML header, then exactly five sections in this order.
${SECTIONS.map((section) => `## ${section}`).join("\n")}

Header:
---
id: sop-<kebab-case>
title: <at most ${MAX_SOP_TITLE} characters>
updated: <YYYY-MM-DD>
rev: <1 the first time, +1 on every later write>
confidence: <0..1>
throughAtom: <id of the newest atom this document draws from>
sources: [<atom ids>]
evidence:
  - <atomId> | <YYYY-MM-DD> | <the one line it supports>
---

Rules:
- Procedure is a numbered list with at least two steps; write decision points as "若 … 则 …" and checkpoints as "确认 …".
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
	const pending = atomsAfter(lines, watermarks.sop).slice(0, 20);
	if (pending.length === 0) return { added: 0, changes: [] };

	const limit = opts.maxSops && opts.maxSops > 0 ? opts.maxSops : MAX_SOPS;
	const docs = await readSopDocs(opts.dir);
	const batch = new Map(pending.map((atom) => [atom.id, atom]));
	const state = { changes: [] as SopChange[], consumed: new Set<string>(), dropped: new Set<string>(), writes: 0 };
	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	let attempts = 0;
	let through: string | null = null;

	if (opts.logRun) {
		try {
			await opts.logRun.start({ runId, stage: "sop", startedAt });
		} catch (error) {
			console.error("sop run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunReason, error?: string): Promise<void> {
		const endedAt = Date.now();
		try {
			await opts.logRun?.end({ runId, stage: "sop", startedAt, endedAt, reason, added: state.changes.length });
		} catch (logError) {
			console.error("sop run end log failed:", logError);
		}
		await appendMemoryRun(opts.dir, {
			runId,
			stage: "sop",
			model: `${opts.model.provider}/${opts.model.id ?? "default"}`,
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

	const tool: AgentTool<typeof sopWriteSchema, { ok: boolean; error?: string }> = {
		name: "sop",
		label: "SOP",
		description: "Read an existing SOP or write a complete SOP document (YAML header + five sections). The engine validates the shape.",
		parameters: sopWriteSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `sop rejected: ${message}` }], details: { ok: false, error: message } });
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });
			if (params.op !== "write") {
				const current = await readSopDocs(opts.dir);
				return note(readSopOp(current, { op: params.op, id: params.id, offset: params.offset, limit: params.limit }));
			}
			const content = (params.content ?? "").trim();
			if (!content) return reject("write needs content (the complete document)");
			const consumed = [...new Set(params.consumed ?? [])].filter((id) => batch.has(id));
			if (consumed.length === 0) return reject("consumed must list at least one atom id from the batch you were given");
			const problem = validateSop(content);
			if (problem) return reject(problem);
			const parsed = parseSop(content);
			if ("problem" in parsed) return reject(parsed.problem);
			const mergedFrom = [...new Set(params.mergedFrom ?? [])].filter((id) => docs.some((doc) => doc.meta.id === id) && id !== parsed.meta.id);
			const existing = docs.some((doc) => doc.meta.id === parsed.meta.id);
			if (!existing && docs.length >= limit) return reject(`SOP limit (${limit}) reached — merge existing SOPs by writing one document with mergedFrom`);
			const unknown = [...new Set([...parsed.meta.sources, ...parsed.meta.evidence.map((item) => item.atomId)])].filter((id) => !batch.has(id));
			if (unknown.length > 0) return reject(`these ids are not in the batch you were given: ${unknown.slice(0, 3).join(", ")}`);
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

	const prompt = [
		"A scheduled SOP pass is running.",
		"",
		`Existing SOPs (${docs.length}/${limit}) — call sop with op "read" for the full body:`,
		docs.length ? docs.map((doc) => `- ${doc.meta.id} · ${doc.meta.title} — ${sectionBody(doc.body, "When").split("\n")[0] ?? ""}`).join("\n") : "(none yet)",
		"",
		`New atoms (${pending.length}):`,
		pending.map((atom) => `- [${atom.id}] ${atom.kind}: ${atom.summary}${atom.detail ? `\n  ${atom.detail.slice(0, 300)}` : ""}`).join("\n"),
		"",
		"Write the SOPs these atoms justify. If none of them belongs in an SOP, call noop.",
	].join("\n");

	try {
		const outcome = await runRalphLoop({
			maxAttempts: 3,
			signal: opts.signal,
			createPass: () => ({ agent: createMemoryAgent(opts.model, opts.streamFn, sopWorkflow(limit), [tool, noop, finish]), prompt }),
			settlePass: () => {
				const covered = new Set([...state.consumed, ...state.dropped]).size;
				if (covered >= pending.length) return "done";
				return covered > 0 || state.writes > 0 ? "advanced" : "stalled";
			},
		});
		attempts = outcome.attempts;
		const newest = [...pending].reverse().find((atom) => state.consumed.has(atom.id) || state.dropped.has(atom.id));
		through = newest?.id ?? null;
		await endRun(outcome.reason);
		return { added: state.changes.length, changes: state.changes, ...(newest ? { through: newest.id } : {}) };
	} catch (error) {
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	}
}
