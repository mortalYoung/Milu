import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureMemoryFile } from "./core/memory";
import { getPartnerDir, partnerRoot, type Settings } from "./lib/settings";

// ————— Partner profiles —————
export interface PartnerProfile {
	name: string;
	/** Responsibilities (user-filled, no default). */
	responsibilities?: string;
	/** Tones (user-filled, no default). */
	tones?: string;
	createdAt: number;
}

export interface PartnerInput {
	name: string;
	responsibilities?: string;
	tones?: string;
}

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

export async function createPartner(settings: Settings, input: PartnerInput): Promise<PartnerProfile> {
	const name = input.name.trim();
	validateName(name);
	const profile: PartnerProfile = {
		name,
		responsibilities: input.responsibilities?.trim() || undefined,
		tones: input.tones?.trim() || undefined,
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

/** Delete a partner: remove the <root>/<name>/ directory (name is validated first to prevent path traversal). */
export async function deletePartner(settings: Settings, name: string): Promise<void> {
	const trimmed = name.trim();
	validateName(trimmed);
	await rm(getPartnerDir(settings, trimmed), { recursive: true, force: true });
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
