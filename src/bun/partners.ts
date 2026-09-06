import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureMemoryFile } from "./core/memory";
import { getPartnerDir, partnerRoot, type Settings } from "./lib/settings";
import type { SessionStore } from "./persist";

// ————— Partner profiles —————
export interface PartnerProfile {
	name: string;
	/** Persona (user-filled, no default): how the partner works and speaks. */
	persona?: string;
	createdAt: number;
	/** Root chats omit this; fork chats point to the root chat they hang under. */
	forkedFrom?: string;
}

export interface PartnerInput {
	name: string;
	persona?: string;
}

export type CopyMode = "duplicate" | "fork";

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** OS-reserved names that must not become folders (case-insensitive). */
const RESERVED_NAMES = new Set([
	"con",
	"prn",
	"aux",
	"nul",
	"com1",
	"com2",
	"com3",
	"com4",
	"com5",
	"com6",
	"com7",
	"com8",
	"com9",
	"lpt1",
	"lpt2",
	"lpt3",
	"lpt4",
	"lpt5",
	"lpt6",
	"lpt7",
	"lpt8",
	"lpt9",
]);

export class PartnerError extends Error {}

/**
 * Validate the partner name: required, letters/digits/underscore/hyphen only (folder-safe —
 * no slashes, dots, or spaces), not an OS-reserved name. The name becomes a folder path.
 */
function validateName(name: string): void {
	if (!name || !NAME_PATTERN.test(name)) {
		throw new PartnerError("Name is required (letters, digits, '_', '-', max 64)");
	}
	if (RESERVED_NAMES.has(name.toLowerCase())) {
		throw new PartnerError(`Name "${name}" cannot be used as a folder`);
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** First free `${base}-2`, `${base}-3`, … against existing names (case-insensitive). */
function nextAvailablePartnerName(base: string, existing: string[]): string {
	const used = new Set(existing.map((name) => name.toLowerCase()));
	for (let i = 2; ; i++) {
		const suffix = `-${i}`;
		const candidate = base.length + suffix.length <= 64 ? base + suffix : base.slice(0, 64 - suffix.length) + suffix;
		if (candidate.length <= 64 && !used.has(candidate.toLowerCase())) return candidate;
	}
}

export async function createPartner(settings: Settings, input: PartnerInput): Promise<PartnerProfile> {
	const name = input.name.trim();
	validateName(name);
	const profile: PartnerProfile = {
		name,
		persona: input.persona?.trim() || undefined,
		createdAt: Date.now(),
	};
	const dir = getPartnerDir(settings, name);
	const profilePath = join(dir, "profile.json");
	if (await pathExists(dir)) {
		throw new PartnerError(`Partner "${name}" already exists`);
	}
	await mkdir(dir, { recursive: true });
	await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n", "utf8");
	await ensureMemoryFile(dir);
	return profile;
}

/** Delete a root chat together with its fork chats (or a fork chat alone). */
export async function deletePartner(settings: Settings, name: string): Promise<void> {
	const profiles = await listPartners(settings);
	const targets = [name, ...profiles.filter((p) => p.forkedFrom === name).map((p) => p.name)];
	for (const target of targets) {
		const trimmed = target.trim();
		validateName(trimmed);
		await rm(getPartnerDir(settings, trimmed), { recursive: true, force: true });
	}
}

/**
 * Copy a chat:
 * - duplicate: same-level copy (root → root, fork → sibling fork under the same root);
 * - fork: root → a one-level fork leaf under it.
 */
export async function copyPartner(settings: Settings, input: { sourceName: string; mode: CopyMode }, store: Pick<SessionStore, "forkTo" | "evictRoot">): Promise<PartnerProfile> {
	const profiles = await listPartners(settings);
	const existing = profiles.map((p) => p.name);
	const source = profiles.find((p) => p.name === input.sourceName);
	if (!source) throw new PartnerError(`Partner "${input.sourceName}" not found`);
	if (input.mode === "fork" && source.forkedFrom) {
		throw new PartnerError(`"${source.name}" is a fork; promote it before forking`);
	}

	const isLeaf = input.mode === "fork" || source.forkedFrom !== undefined;
	const parentRoot = input.mode === "fork" ? source.name : source.forkedFrom;
	const targetName = isLeaf ? nextAvailablePartnerName(`${parentRoot}-fork`, existing) : nextAvailablePartnerName(source.name, existing);
	const forkedFrom = input.mode === "fork" ? source.name : source.forkedFrom;

	const sourceDir = getPartnerDir(settings, source.name);
	const targetDir = getPartnerDir(settings, targetName);
	const createdAt = Date.now();

	try {
		await store.forkTo(sourceDir, targetDir);
		const raw = JSON.parse(await readFile(join(targetDir, "profile.json"), "utf8")) as Record<string, unknown>;
		await writeFile(join(targetDir, "profile.json"), JSON.stringify({ ...raw, name: targetName, createdAt, ...(forkedFrom ? { forkedFrom } : {}) }, null, 2) + "\n", "utf8");
	} catch (error) {
		store.evictRoot(targetDir);
		await rm(targetDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}

	return { name: targetName, persona: source.persona, createdAt, ...(forkedFrom ? { forkedFrom } : {}) };
}

/** Turn a fork chat into a root chat by removing its `forkedFrom` pointer. */
export async function promotePartner(settings: Settings, name: string): Promise<PartnerProfile> {
	const trimmed = name.trim();
	validateName(trimmed);
	const dir = getPartnerDir(settings, trimmed);
	const raw = JSON.parse(await readFile(join(dir, "profile.json"), "utf8")) as Record<string, unknown>;
	if (!raw["forkedFrom"]) throw new PartnerError(`"${trimmed}" is already a root chat`);
	delete raw["forkedFrom"];
	await writeFile(join(dir, "profile.json"), JSON.stringify(raw, null, 2) + "\n", "utf8");
	return raw as unknown as PartnerProfile;
}

/** List all partners (sorted by creation time). */
export async function listPartners(settings: Settings): Promise<PartnerProfile[]> {
	let entries;
	try {
		entries = await readdir(partnerRoot(settings), { withFileTypes: true });
	} catch {
		return [];
	}
	const profiles: PartnerProfile[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const profile = JSON.parse(await readFile(join(partnerRoot(settings), entry.name, "profile.json"), "utf8")) as PartnerProfile;
			profiles.push(profile);
		} catch {
			// Directories without a profile.json are ignored
		}
	}
	return profiles.sort((a, b) => a.createdAt - b.createdAt);
}
