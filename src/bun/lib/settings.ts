import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SandboxMode } from "../permission";

export type ThemeMode = "system" | "light" | "dark";

export type ToastPlacement = "topcenter" | "topright" | "bottomcenter" | "bottomright";

export const DEFAULT_MEMORY_MAX_SCENES = 15;
export const DEFAULT_MEMORY_PENDING_ROUNDS = 10;

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
	partner_profile_path: string;
	detect_instructions_file: string;
	defaultSandboxMode?: SandboxMode;
	providers?: string[];
	customProviders?: CustomProvider[];
	theme?: ThemeMode;
	toastPlacement?: ToastPlacement;
	toastDurationMs?: number;
	skills_dirs?: string[];
	skills_watch?: boolean;
	skills_watch_delay_ms?: number;
	shellContinuous?: boolean;
	rememberSession?: boolean;
	memoryEnabled?: boolean;
	memoryIdleMinutes?: number;
	memoryMaxScenes?: number;
	memoryPendingRounds?: number;
	commands_path?: string;
	mcp_config_path?: string;
	retry?: { maxRetries?: number; baseDelayMs?: number };
	bash?: { timeoutSec?: number };
	delete?: { strict?: boolean };
	webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
	compaction?: {
		thresholdRatio?: number;
		digestMaxItems?: number;
		maxOverflowRetries?: number;
		prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
	};
	explorer?: { lineGap?: number; fold?: { braces?: boolean; markdown?: boolean } };
	highlight?: { tokenizeMaxLineLength?: number; tokenizeTimeLimit?: number };
	palette?: { searchIgnoreDirs?: string[] };
}

export const DEFAULT_PALETTE_IGNORE_DIRS = [".git", ".DS_Store", "node_modules", "dist", "build", ".next", "out", "target", ".cache", "__pycache__", ".venv", "venv"];

const DEFAULT_SETTINGS: Settings = {
	partner_profile_path: "~/.partner/",
	detect_instructions_file: "AGENTS.md",
	defaultSandboxMode: "workspace-write",
	commands_path: "~/.config/letters/commands",
	mcp_config_path: "~/.config/letters/mcp.json",
	theme: "system",
	toastPlacement: "bottomcenter",
	toastDurationMs: 4000,
	skills_dirs: [".agents/skills"],
	skills_watch: true,
	skills_watch_delay_ms: 300,
	shellContinuous: true,
	rememberSession: true,
	memoryEnabled: true,
	memoryIdleMinutes: 5,
	memoryMaxScenes: DEFAULT_MEMORY_MAX_SCENES,
	memoryPendingRounds: DEFAULT_MEMORY_PENDING_ROUNDS,
	delete: { strict: true },
	explorer: { lineGap: 0.2, fold: { braces: true, markdown: true } },
	highlight: { tokenizeMaxLineLength: 3000, tokenizeTimeLimit: 500 },
};

const SETTINGS_PATH = join(homedir(), ".config", "letters", "settings.json");

export async function loadSettings(): Promise<Settings> {
	try {
		const parsed = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<Settings> & { skills_dir?: unknown };
		const merged = { ...DEFAULT_SETTINGS, ...parsed };
		if (merged.skills_dirs === undefined && typeof parsed.skills_dir === "string" && parsed.skills_dir.trim()) {
			merged.skills_dirs = [parsed.skills_dir.trim()];
		}
		return merged;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export async function saveSettings(settings: Settings): Promise<void> {
	await mkdir(join(homedir(), ".config", "letters"), { recursive: true });
	await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
	await chmod(SETTINGS_PATH, 0o600);
}

function expandHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export function partnerRoot(settings: Settings): string {
	return expandHome(settings.partner_profile_path);
}

export function getPartnerDir(settings: Settings, name: string): string {
	return join(partnerRoot(settings), name);
}

const DEFAULT_COMMANDS_PATH = "~/.config/letters/commands";

export const DEFAULT_MCP_CONFIG_PATH = "~/.config/letters/mcp.json";

export function commandsDir(settings: Settings): string {
	return expandHome(settings.commands_path?.trim() ? settings.commands_path : DEFAULT_COMMANDS_PATH);
}
