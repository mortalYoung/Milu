/**
 * Partner management: settings (~/.config/.partner) and Partner profiles
 * (~/.partner/<name>/profile.json, path configurable).
 */
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ————— Settings —————
export interface Settings {
	/** Root directory for Partner profile storage (where partners get created). */
	partner_profile_path: string;
}

const DEFAULT_SETTINGS: Settings = {
	partner_profile_path: "~/.partner/",
};

const SETTINGS_PATH = join(homedir(), ".config", ".partner");

/** Expand a leading ~ into the user's home directory. */
function expandHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export async function loadSettings(): Promise<Settings> {
	try {
		const parsed = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<Settings>;
		return { ...DEFAULT_SETTINGS, ...parsed };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(settings: Settings): Promise<void> {
	await mkdir(join(homedir(), ".config"), { recursive: true });
	await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

// ————— Partner profiles —————
export interface PartnerProfile {
	name: string;
	avatar?: string;
	/** Role phrase (e.g. "Front-End Programmer"), required. */
	role?: string;
	/** Responsibilities (user-filled, no default). */
	responsibilities?: string;
	/** Tones (user-filled, no default). */
	tones?: string;
	createdAt: number;
}

export interface PartnerInput {
	name: string;
	avatar?: string;
	/** Role phrase (e.g. "Front-End Programmer"), required. */
	role: string;
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

/** Validate role: required (role phrase, e.g. "Front-End Programmer"). */
function validateRole(role: string): void {
	if (!role?.trim()) {
		throw new PartnerError("Role is required (e.g. Front-End Programmer)");
	}
}

export function partnerRoot(settings: Settings): string {
	return expandHome(settings.partner_profile_path);
}

export function partnerDir(settings: Settings, name: string): string {
	return join(partnerRoot(settings), name);
}

/** Create a partner: create the folder under <root>/<name>/ and write profile.json. */
export async function createPartner(settings: Settings, input: PartnerInput): Promise<PartnerProfile> {
	const name = input.name.trim();
	validateName(name);
	validateRole(input.role);
	const profile: PartnerProfile = {
		name,
		avatar: input.avatar?.trim() || undefined,
		role: input.role.trim(),
		responsibilities: input.responsibilities?.trim() || undefined,
		tones: input.tones?.trim() || undefined,
		createdAt: Date.now(),
	};
	const dir = partnerDir(settings, name);
	const profilePath = join(dir, "profile.json");
	try {
		// Reject when the folder already exists (with or without profile.json) — the name becomes a folder,
		// so any existing folder of that name is a conflict (case-insensitive on common macOS/Windows setups)
		await access(dir);
		throw new PartnerError(`Partner "${name}" already exists`);
	} catch (error) {
		if (error instanceof PartnerError) throw error;
		// Directory does not exist → proceed with normal creation
	}
	await mkdir(dir, { recursive: true });
	await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n", "utf8");
	return profile;
}

/** Delete a partner: remove the <root>/<name>/ directory (name is validated first to prevent path traversal). */
export async function deletePartner(settings: Settings, name: string): Promise<void> {
	const trimmed = name.trim();
	validateName(trimmed);
	await rm(partnerDir(settings, trimmed), { recursive: true, force: true });
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
