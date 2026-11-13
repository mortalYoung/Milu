import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type AgentTool, type Model, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
import { startDeadline } from "./deadline.ts";
import { runRalphLoop } from "./loop.ts";
import { appendMemoryRun, atomsAfter, ensureMemoryDir, memoryDir, type MemoryRecord, type MemoryRunLog, type MemoryRunReason, readMemoryLines, readWatermarks } from "./store.ts";

export const personaPath = (dir: string) => join(memoryDir(dir), "persona.md");
export const MAX_PERSONA_CONTENT = 1200;
export const MAX_PERSONA_LINE = 120;
export const PERSONA_SECTIONS = ["Relationship", "Taste"] as const;
const STAGE_TIMEOUT_MS = 3 * 60_000;
const MAX_RELATIONSHIP = 4;
const MAX_TASTE = 6;
const MAX_TASTE_GROUP = 3;

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
	{ pattern: /\/Users\//, why: "absolute paths belong in the atoms, not in the persona" },
	{ pattern: /0x[0-9a-f]{7,}/i, why: "commit ids belong in the atoms, not in the persona" },
	{ pattern: /已办/, why: "task progress belongs in the atoms" },
	{ pattern: /未\s*push/, why: "branch state belongs in the atoms" },
];

export interface PersonaMeta {
	readonly rev: number;
	readonly updated: string;
	readonly throughAtom: string;
	readonly sources: readonly string[];
}

export interface PersonaDoc {
	readonly meta: PersonaMeta;
	readonly header: string;
	readonly body: string;
	readonly content: string;
}

function split(content: string): { header: string; body: string } | null {
	const text = content.replace(/\r\n/g, "\n").trim();
	if (!text.startsWith("---\n")) return null;
	const end = text.indexOf("\n---", 4);
	if (end < 0) return null;
	return {
		header: text.slice(4, end),
		body: text
			.slice(end + 4)
			.replace(/^\n+/, "")
			.trim(),
	};
}

function field(header: string, key: string): string | null {
	const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(header);
	return match ? (match[1] ?? "").trim() : null;
}

function listField(header: string, key: string): string[] | null {
	const value = field(header, key);
	if (value === null || !value.startsWith("[") || !value.endsWith("]")) return null;
	const inner = value.slice(1, -1).trim();
	return inner === "" ? [] : inner.split(",").map((item) => item.trim().replace(/^["']|["']$/g, ""));
}

function bullets(body: string, section: string): string[] {
	const pattern = new RegExp(`^## ${section}\\n`, "m");
	const match = pattern.exec(body);
	if (!match) return [];
	const rest = body.slice(match.index + match[0].length);
	const next = /\n## /.exec(rest);
	const text = next ? rest.slice(0, next.index) : rest;
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim());
}

export function parsePersona(content: string): PersonaDoc | { problem: string } {
	const parts = split(content);
	if (!parts) return { problem: "missing YAML header: the document must start with --- and end the header with ---" };
	const rev = Number(field(parts.header, "rev") ?? "");
	const updated = field(parts.header, "updated") ?? "";
	const throughAtom = field(parts.header, "throughAtom") ?? "";
	const sources = listField(parts.header, "sources");
	if (!Number.isFinite(rev) || rev < 1) return { problem: "header field rev must be a positive integer" };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) return { problem: "header field updated must be YYYY-MM-DD" };
	if (!throughAtom) return { problem: "header field throughAtom is missing" };
	if (sources === null) return { problem: "header field sources must be a list, e.g. sources: [mem-1, mem-2]" };
	return { meta: { rev, updated, throughAtom, sources }, header: parts.header, body: parts.body, content: content.trim() };
}

export function validatePersona(content: string): string | null {
	const parsed = parsePersona(content);
	if ("problem" in parsed) return parsed.problem;
	const { body } = parsed;
	const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => (match[1] ?? "").trim());
	if (headings.join("|") !== PERSONA_SECTIONS.join("|")) {
		return `body sections must be exactly ${PERSONA_SECTIONS.map((section) => `## ${section}`).join(", ")} in this order (found: ${headings.join(", ") || "none"})`;
	}
	if (content.trim().length > MAX_PERSONA_CONTENT)
		return `the document is ${content.trim().length} characters, ${content.trim().length - MAX_PERSONA_CONTENT} over the ${MAX_PERSONA_CONTENT} limit — drop the least valuable line and rewrite the whole document shorter`;
	const relationship = bullets(body, "Relationship");
	const taste = bullets(body, "Taste");
	if (relationship.length > MAX_RELATIONSHIP) return `Relationship has ${relationship.length} lines (max ${MAX_RELATIONSHIP})`;
	if (taste.length > MAX_TASTE) return `Taste has ${taste.length} lines (max ${MAX_TASTE})`;
	const groups = { ui: 0, rhythm: 0 };
	for (const line of taste) {
		const group = /^\[(ui|rhythm)\]/.exec(line)?.[1];
		if (group === "ui" || group === "rhythm") groups[group] += 1;
	}
	if (groups.ui > MAX_TASTE_GROUP) return `Taste [ui] has ${groups.ui} lines (max ${MAX_TASTE_GROUP})`;
	if (groups.rhythm > MAX_TASTE_GROUP) return `Taste [rhythm] has ${groups.rhythm} lines (max ${MAX_TASTE_GROUP})`;
	for (const line of [...relationship, ...taste]) {
		if (line.length > MAX_PERSONA_LINE) return `a line is ${line.length} characters (max ${MAX_PERSONA_LINE}): ${line.slice(0, 40)}…`;
		if (!/[(（]mem-[0-9a-z-]{3,},\s*\d{4}-\d{2}-\d{2}[)）]/.test(line)) return `every line needs a trailing (mem-…, YYYY-MM-DD) citation: ${line.slice(0, 40)}…`;
	}
	for (const rule of FORBIDDEN) if (rule.pattern.test(body)) return `the persona must not mention this: ${rule.why}`;
	return null;
}

export async function personaSignature(dir: string): Promise<string> {
	try {
		const info = await stat(personaPath(dir));
		return `${info.mtimeMs}:${info.size}`;
	} catch {
		return "none";
	}
}

export async function readPersonaDoc(dir: string): Promise<PersonaDoc | null> {
	try {
		const parsed = parsePersona(await readFile(personaPath(dir), "utf8"));
		return "problem" in parsed ? null : parsed;
	} catch {
		return null;
	}
}

export async function writePersonaDoc(dir: string, content: string): Promise<PersonaDoc> {
	const parsed = parsePersona(content);
	if ("problem" in parsed) throw new Error(parsed.problem);
	if (!(await ensureMemoryDir(dir))) throw new Error("memory directory is not available");
	await writeFile(personaPath(dir), `${parsed.content}\n`, "utf8");
	return parsed;
}

function isRoleAtom(atom: MemoryRecord): boolean {
	if (atom.kind === "preference" || atom.kind === "instruction") return true;
	return atom.kind === "attribute" && /role|identity|角色|身份/i.test(atom.predicate ?? "");
}

export interface PersonaTrigger {
	readonly run: boolean;
	readonly atoms: readonly MemoryRecord[];
}

export async function personaTrigger(dir: string): Promise<PersonaTrigger> {
	const lines = await readMemoryLines(dir);
	const watermarks = await readWatermarks(dir);
	const atoms = atomsAfter(lines, watermarks.persona).filter(isRoleAtom).slice(0, 20);
	return { run: atoms.length > 0, atoms };
}

const WORKFLOW = `You maintain this partner's persona file. It has exactly two sections:

## Relationship
Who the partner works with, who accepts the work, who authorises what. At most ${MAX_RELATIONSHIP} lines.

## Taste
Cross-task aesthetics and collaboration rhythm. At most ${MAX_TASTE} lines, each tagged [ui] or [rhythm], at most ${MAX_TASTE_GROUP} of each.

Rules:
- Every line ends with (mem-…, YYYY-MM-DD) citing the atom it came from, and is at most ${MAX_PERSONA_LINE} characters.
- Use only the atoms you are given. Never invent, never speculate.
- Project rules (commit authorisation, gates, comment policy, evidence rules) belong to AGENTS.md — put those atoms in dropped.
- Environment limits (sandbox, permissions, tool quirks) belong to the instance caveats — put those atoms in dropped.
- Task progress, paths, branch state and step-by-step procedures do not belong here — put them in dropped.
- Rewrite the whole document; never send a diff. Header: rev (+1), updated, throughAtom, sources.`;

const noopSchema = Type.Object({ consumed: Type.Array(Type.String()), dropped: Type.Optional(Type.Array(Type.String())) });

const schema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("write")], { description: "read: the current document; write: the whole rewritten document" }),
	content: Type.Optional(Type.String({ description: `write: the complete persona file (header + both sections, max ${MAX_PERSONA_CONTENT} characters)` })),
	consumed: Type.Optional(Type.Array(Type.String({ description: "write: ids of the atoms this document actually uses" }))),
	dropped: Type.Optional(Type.Array(Type.String({ description: "write: ids of atoms that belong somewhere else, not in the persona" }))),
});

async function runPersona(opts: OrganizePersonaOptions, atoms: readonly MemoryRecord[], current: PersonaDoc | null): Promise<{ writes: number; through?: string }> {
	const batch = new Map(atoms.map((atom) => [atom.id, atom]));
	const state = { writes: 0, content: current?.content ?? "", consumed: new Set<string>(), dropped: new Set<string>(), throughAtomId: "" };
	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	let attempts = 0;

	if (opts.logRun) {
		try {
			await opts.logRun.start({ runId, stage: "persona", startedAt });
		} catch (error) {
			console.error("persona run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunReason, error?: string): Promise<void> {
		const endedAt = Date.now();
		try {
			await opts.logRun?.end({ runId, stage: "persona", startedAt, endedAt, reason, added: state.writes });
		} catch (logError) {
			console.error("persona run end log failed:", logError);
		}
		await appendMemoryRun(opts.dir, {
			runId,
			stage: "persona",
			model: `${opts.model.provider}/${opts.model.id ?? "default"}`,
			startedAt,
			endedAt,
			durationMs: endedAt - startedAt,
			reason,
			attempts,
			added: state.writes,
			targetRawId: null,
			cursorRawId: null,
			...(state.throughAtomId || current ? { throughAtomId: state.throughAtomId || current?.meta.throughAtom } : {}),
			...(error ? { error } : {}),
		});
	}

	let rejections = 0;
	const tool: AgentTool<typeof schema, { ok: boolean; error?: string }> = {
		name: "persona",
		label: "Persona",
		description: "Read the current persona document, or rewrite it whole (header + Relationship + Taste). The engine validates the shape and the citations.",
		parameters: schema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => {
				rejections += 1;
				return {
					content: [{ type: "text" as const, text: `persona rejected: ${message}${rejections >= 10 ? " — stopping this pass; nothing was written" : ""}` }],
					details: { ok: false, error: message },
					...(rejections >= 10 ? { terminate: true } : {}),
				};
			};
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });
			if (params.op === "read") return note(state.content || "No persona yet — write the first document.");
			const content = (params.content ?? "").trim();
			if (!content) return reject("write needs content (the whole document, not a diff)");
			const problem = validatePersona(content);
			if (problem) return reject(problem);
			const parsed = parsePersona(content);
			if ("problem" in parsed) return reject(parsed.problem);
			const consumed = [...new Set([...(params.consumed ?? []), ...parsed.meta.sources])].filter((id) => batch.has(id));
			if (consumed.length === 0) return reject("consumed (or the document's sources) must list at least one atom id from the batch");
			const unknown = parsed.meta.sources.filter((id) => !batch.has(id) && !(current?.meta.sources ?? []).includes(id));
			if (unknown.length > 0) return reject(`these sources are not in the batch you were given: ${unknown.slice(0, 3).join(", ")}`);
			await writePersonaDoc(opts.dir, content);
			state.content = content;
			state.throughAtomId = parsed.meta.throughAtom;
			state.writes += 1;
			for (const id of consumed) state.consumed.add(id);
			return note(`persona rev ${parsed.meta.rev} written`);
		},
	};

	const noop: AgentTool<typeof noopSchema, { ok: boolean }> = {
		name: "noop",
		label: "No-op",
		description: "Tell the engine that none of these atoms belong in the persona.",
		parameters: noopSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			for (const id of [...params.consumed, ...(params.dropped ?? [])]) if (batch.has(id)) state.dropped.add(id);
			if (params.consumed.length === 0) state.dropped.add(atoms[0]!.id);
			return { content: [{ type: "text", text: "Noted; persona unchanged." }], details: { ok: true }, terminate: true };
		},
	};

	const prompt = [
		"A scheduled persona pass is running.",
		"",
		"Current persona:",
		current?.content ?? "(none yet)",
		"",
		`Atoms to consume (${atoms.length}):`,
		atoms.map((atom) => `- [${atom.id}] ${atom.kind}: ${atom.summary}${atom.detail ? `\n  ${atom.detail.slice(0, 300)}` : ""}`).join("\n"),
		"",
		"Rewrite the persona so it reflects these atoms. If none of them belongs here, call noop.",
	].join("\n");

	const deadline = startDeadline(opts.signal, STAGE_TIMEOUT_MS);
	try {
		const outcome = await runRalphLoop({
			maxAttempts: 3,
			signal: deadline.signal,
			createPass: () => ({ agent: createMemoryAgent(opts.model, opts.streamFn, WORKFLOW, [tool, noop]), prompt }),
			settlePass: () => {
				const covered = new Set([...state.consumed, ...state.dropped]).size;
				if (covered >= atoms.length) return "done";
				return covered > 0 || state.writes > 0 ? "advanced" : "stalled";
			},
		});
		attempts = outcome.attempts;
		const newest = [...atoms].reverse().find((atom) => state.consumed.has(atom.id) || state.dropped.has(atom.id));
		await endRun(deadline.timedOut() ? "blocked" : outcome.reason);
		return { writes: state.writes, ...(newest ? { through: newest.id } : {}) };
	} catch (error) {
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		deadline.cancel();
	}
}

export interface OrganizePersonaOptions {
	readonly dir: string;
	readonly model: Model<any>;
	readonly streamFn: StreamFn;
	readonly signal?: AbortSignal;
	readonly logRun?: MemoryRunLog;
}

export async function organizePersona(opts: OrganizePersonaOptions): Promise<{ writes: number; through?: string }> {
	const trigger = await personaTrigger(opts.dir);
	if (!trigger.run) return { writes: 0 };
	return runPersona(opts, trigger.atoms, await readPersonaDoc(opts.dir));
}
