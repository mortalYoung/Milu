import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SandboxMode } from "../permission";

/** UI theme: follow the system appearance, or force light/dark. */
export type ThemeMode = "system" | "light" | "dark";

export interface CustomModel {
	id: string;
	contextWindow?: number;
	maxTokens?: number;
}

export interface CustomProvider {
	id: string;
	name?: string;
	baseUrl: string;
	models: CustomModel[];
	defaultContextWindow?: number;
	defaultMaxTokens?: number;
}

export interface Settings {
	/** Root directory for Partner profile storage (where partners get created). */
	partner_profile_path: string;
	/** Instructions file read by set_workspace (relative to the workspace root). */
	detect_instructions_file: string;
	/** Default sandbox mode for newly created partners (the Permission setting). */
	defaultSandboxMode?: SandboxMode;
	providers?: string[];
	customProviders?: CustomProvider[];
	/** UI theme; the view applies it to color-scheme (light-dark() tokens do the rest). */
	theme?: ThemeMode;
}

const DEFAULT_SETTINGS: Settings = {
	partner_profile_path: "~/.partner/",
	detect_instructions_file: "AGENTS.md",
	defaultSandboxMode: "workspace-write",
	theme: "system",
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
