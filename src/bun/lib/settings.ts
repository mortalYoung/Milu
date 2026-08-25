import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Settings {
	/** Root directory for Partner profile storage (where partners get created). */
	partner_profile_path: string;
	/** Instructions file read by set_workspace (relative to the workspace root). */
	detect_instructions_file: string;
	/** The added LLM providers (each builtin id at most once; keys live in .credentials.yaml). */
	providers?: string[];
}

const DEFAULT_SETTINGS: Settings = {
	partner_profile_path: "~/.partner/",
	detect_instructions_file: "AGENTS.md",
};

const SETTINGS_PATH = join(homedir(), ".config", "letters", "settings.json");

export async function loadSettings(): Promise<Settings> {
	try {
		const parsed = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<Settings>;
		return { ...DEFAULT_SETTINGS, ...parsed };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(settings: Settings): Promise<void> {
	await mkdir(join(homedir(), ".config", "letters"), { recursive: true });
	// The file holds the user's api key — never world-readable
	await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
	await chmod(SETTINGS_PATH, 0o600);
}

/** Expand a leading ~ into the user's home directory. */
function expandHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export function partnerRoot(settings: Settings): string {
	return expandHome(settings.partner_profile_path);
}

export function getPartnerDir(settings: Settings, name: string): string {
	return join(partnerRoot(settings), name);
}
