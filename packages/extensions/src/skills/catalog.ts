import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

export type SkillScope = "project" | "global";

export interface SkillInvocationPolicy {
	readonly modelInvocable: boolean;
	readonly userInvocable: boolean;
}

export interface SkillSummary {
	readonly name: string;
	readonly description: string;
	readonly whenToUse?: string;
	readonly invocation: SkillInvocationPolicy;
	readonly scope: SkillScope;
	readonly source: "project-agents" | "global" | (string & {});
	readonly path?: string;
}

export interface SkillDefinition extends SkillSummary {
	readonly content: string;
	readonly metadata?: Record<string, unknown>;
}

export interface SkillLookup {
	readonly cwd: string | null;
	readonly home: string;
	readonly skillsDirs: readonly string[];
	readonly granted: readonly string[];
}

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

interface Frontmatter {
	readonly end: number;
	readonly data: Record<string, unknown> | null;
}

function parseFrontmatter(text: string): Frontmatter | null {
	const match = FRONTMATTER.exec(text);
	if (!match) return null;
	const raw = match[1] ?? "";
	try {
		const data = parse(raw);
		if (data && typeof data === "object" && !Array.isArray(data)) return { end: match[0].length, data: data as Record<string, unknown> };
	} catch {}
	return { end: match[0].length, data: null };
}

interface ParsedSkill {
	readonly name: string;
	readonly description: string;
	readonly whenToUse?: string;
	readonly metadata?: Record<string, unknown>;
	readonly invocation: SkillInvocationPolicy;
	readonly content: string;
}

function boolValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const text = value.trim().toLowerCase();
		if (["true", "yes", "on", "1"].includes(text)) return true;
		if (["false", "no", "off", "0"].includes(text)) return false;
	}
	if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
	return undefined;
}

function parseSkillFile(text: string): ParsedSkill | null {
	const head = parseFrontmatter(text);
	if (!head?.data) return null;
	const front = head.data;
	const name = typeof front["name"] === "string" ? front["name"].trim() : "";
	if (!SKILL_NAME_RE.test(name)) return null;
	const description = typeof front["description"] === "string" ? front["description"].trim() : "";
	if (!description) return null;

	const disableModel = boolValue(front["disable-model-invocation"]);
	const userInvocable = boolValue(front["user-invocable"]);
	if (disableModel === undefined && front["disable-model-invocation"] !== undefined) return null;
	if (userInvocable === undefined && front["user-invocable"] !== undefined) return null;

	const whenToUse = typeof front["whenToUse"] === "string" && front["whenToUse"].trim() ? front["whenToUse"].trim() : undefined;
	const metadata = front["metadata"] && typeof front["metadata"] === "object" && !Array.isArray(front["metadata"]) ? (front["metadata"] as Record<string, unknown>) : undefined;

	return {
		name,
		description,
		...(whenToUse ? { whenToUse } : {}),
		...(metadata ? { metadata } : {}),
		invocation: { modelInvocable: disableModel === undefined ? true : !disableModel, userInvocable: userInvocable === undefined ? true : userInvocable },
		content: text.slice(head.end).trimStart(),
	};
}

interface SkillCandidate extends SkillSummary {
	readonly rank: number;
}

async function scanSkillsRoot(root: string, scope: SkillScope, source: SkillSummary["source"], rank: number): Promise<SkillCandidate[]> {
	let names: string[];
	try {
		names = await readdir(root);
	} catch {
		return [];
	}

	const candidates: SkillCandidate[] = [];
	for (const name of names) {
		const full = join(root, name);
		const info = await stat(full).catch(() => null);
		if (!info) continue;

		let file: string | null = null;
		if (info.isDirectory()) {
			const skillFile = join(full, "SKILL.md");
			if (
				await stat(skillFile).then(
					(each) => each.isFile(),
					() => false,
				)
			)
				file = skillFile;
		} else if (info.isFile() && name.endsWith(".md")) {
			file = full;
		}
		if (!file) continue;

		const text = await readFile(file, "utf8").catch(() => null);
		if (text === null) continue;
		const parsed = parseSkillFile(text);
		if (!parsed) {
			console.warn(`skill: dropped invalid skill at ${full}`);
			continue;
		}
		candidates.push({ ...parsed, scope, source, path: file, rank });
	}
	return candidates;
}

async function listCandidates(lookup: Omit<SkillLookup, "granted">): Promise<SkillCandidate[]> {
	const dirs = lookup.skillsDirs.length > 0 ? lookup.skillsDirs : [".agents/skills"];
	const candidates: SkillCandidate[] = [];
	for (let at = 0; at < dirs.length; at += 1) {
		const rank = 100 + at * 10;
		const projectRoot = lookup.cwd ? join(lookup.cwd, dirs[at]!) : null;
		if (projectRoot) candidates.push(...(await scanSkillsRoot(projectRoot, "project", "project-agents", rank)));
		candidates.push(...(await scanSkillsRoot(join(lookup.home, dirs[at]!), "global", "global", rank + 1)));
	}

	const byName = new Map<string, SkillCandidate>();
	for (const candidate of candidates) {
		const existing = byName.get(candidate.name);
		if (!existing) {
			byName.set(candidate.name, candidate);
			continue;
		}
		if (candidate.scope === "project" && existing.scope !== "project") {
			byName.set(candidate.name, candidate);
			continue;
		}
		if (candidate.scope === existing.scope && candidate.rank < existing.rank) byName.set(candidate.name, candidate);
	}
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function visible(candidate: SkillSummary, granted: readonly string[]): boolean {
	return candidate.scope === "project" || granted.includes(candidate.name);
}

/** v1's Skills page listed the global roots only: what every chat can be granted. */
export async function listGlobalSkills(lookup: { readonly home: string; readonly skillsDirs: readonly string[] }): Promise<SkillSummary[]> {
	const dirs = lookup.skillsDirs.length > 0 ? lookup.skillsDirs : [".agents/skills"];
	const candidates: SkillCandidate[] = [];
	for (let at = 0; at < dirs.length; at += 1) candidates.push(...(await scanSkillsRoot(join(lookup.home, dirs[at]!), "global", "global", 200 + at * 10)));
	const byName = new Map<string, SkillCandidate>();
	for (const candidate of [...candidates].sort((left, right) => left.rank - right.rank)) if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Every candidate, granted or not — what the Access palette lists so a grant can be made. */
export async function listAllSkills(lookup: SkillLookup): Promise<SkillSummary[]> {
	return listCandidates(lookup);
}

export async function listSkills(lookup: SkillLookup): Promise<SkillSummary[]> {
	return (await listCandidates(lookup)).filter((candidate) => visible(candidate, lookup.granted));
}

export async function getSkill(name: string, lookup: SkillLookup): Promise<SkillDefinition | undefined> {
	if (!SKILL_NAME_RE.test(name)) return undefined;
	const summary = (await listSkills(lookup)).find((skill) => skill.name === name);
	if (!summary?.path) return undefined;

	const text = await readFile(summary.path, "utf8").catch(() => null);
	if (text === null) return undefined;
	const parsed = parseSkillFile(text);
	if (!parsed || parsed.name !== name) return undefined;
	return { ...summary, content: parsed.content, ...(parsed.metadata ? { metadata: parsed.metadata } : {}) };
}
