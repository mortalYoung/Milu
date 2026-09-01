import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SandboxMode } from "../permission";

/** UI theme: follow the system appearance, or force light/dark. */
export type ThemeMode = "system" | "light" | "dark";

/** Where transient toast notifications appear. */
export type ToastPlacement = "topcenter" | "topright" | "bottomcenter" | "bottomright";

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
	/** Where toast notifications appear. */
	toastPlacement?: ToastPlacement;
	toastDurationMs?: number;
	skills_dirs?: string[];
	skills_watch?: boolean;
	skills_watch_delay_ms?: number;
	/** Seconds between visible send_message heartbeats during a run; null/undefined = only first and last. */
	sendMessageIntervalSec?: number | null;
	commands_path?: string;
	retry?: { maxRetries?: number; baseDelayMs?: number };
	webFetch?: { timeoutMs?: number; maxBytes?: number; maxChars?: number; userAgent?: string };
	compaction?: {
		thresholdRatio?: number;
		tailBudget?: number;
		summaryCapChars?: number;
		maxOverflowRetries?: number;
		summarizer?: "local" | "llm";
		summarizationModel?: string;
		prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
	};
}

const DEFAULT_SETTINGS: Settings = {
	partner_profile_path: "~/.partner/",
	detect_instructions_file: "AGENTS.md",
	defaultSandboxMode: "workspace-write",
	commands_path: "~/.config/letters/commands",
	theme: "system",
	toastPlacement: "bottomcenter",
	toastDurationMs: 4000,
	skills_dirs: [".agents/skills"],
	skills_watch: true,
	skills_watch_delay_ms: 300,
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
	// The file holds the user's api key — never world-readable
	await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
	await chmod(SETTINGS_PATH, 0o600);
}

/** Effective visible-message interval in ms: ∞ (first + last only) when unset or null, else clamped to ≥20s. */
export function sendMessageIntervalMs(settings: Settings): number {
	const sec = settings.sendMessageIntervalSec;
	if (sec == null) return Number.POSITIVE_INFINITY;
	return Math.max(20, sec) * 1000;
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

const DEFAULT_COMMANDS_PATH = "~/.config/letters/commands";

export function commandsDir(settings: Settings): string {
	return expandHome(settings.commands_path?.trim() ? settings.commands_path : DEFAULT_COMMANDS_PATH);
}
