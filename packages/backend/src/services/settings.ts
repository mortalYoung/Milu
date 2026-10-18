import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { createServiceId, type Service } from "@milu/di";

import type { ConfigService } from "./config.ts";

export type ThemeMode = "system" | "light" | "dark";
export type ToastPlacement = "topcenter" | "topright" | "bottomcenter" | "bottomright";
/** Belongs with the permission facility once it exists; settings is only its first reader. */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

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

/** The settings file is shared with v1, which reads these seven keys in snake_case — the names are the format. */
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
	schedulesEnabled?: boolean;
	schedulesMaxConcurrent?: number;
	schedulesDailyCap?: number;
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

export const DEFAULT_MEMORY_MAX_SCENES = 15;
export const DEFAULT_MEMORY_PENDING_ROUNDS = 10;
export const DEFAULT_PALETTE_IGNORE_DIRS = [".git", ".DS_Store", "node_modules", "dist", "build", ".next", "out", "target", ".cache", "__pycache__", ".venv", "venv"];

export function expandHome(value: string): string {
	return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}

function defaults(root: string): Settings {
	return {
		partner_profile_path: "~/.partner/",
		detect_instructions_file: "AGENTS.md",
		defaultSandboxMode: "workspace-write",
		commands_path: join(root, "commands"),
		mcp_config_path: join(root, "mcp.json"),
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
		schedulesEnabled: true,
		schedulesMaxConcurrent: 3,
		schedulesDailyCap: 200,
		memoryMaxScenes: DEFAULT_MEMORY_MAX_SCENES,
		memoryPendingRounds: DEFAULT_MEMORY_PENDING_ROUNDS,
		delete: { strict: true },
		explorer: { lineGap: 0.2, fold: { braces: true, markdown: true } },
		highlight: { tokenizeMaxLineLength: 3000, tokenizeTimeLimit: 500 },
	};
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asPatch(value: unknown): Partial<Settings> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected a settings object");
	return value as Partial<Settings>;
}

export class SettingsService implements Service {
	readonly file: string;

	private _settings: Settings;
	private _loaded = false;

	constructor(private readonly _configService: ConfigService) {
		this.file = join(this._configService.root, "settings.json");
		this._settings = defaults(this._configService.root);
	}

	async initialize(): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(this.file, "utf8");
		} catch (error) {
			if (!isMissing(error)) throw new Error(`cannot read ${this.file}: ${reason(error)}`);
			this._loaded = true;
			return;
		}
		try {
			this._settings = { ...this._settings, ...asPatch(JSON.parse(raw)) };
		} catch (error) {
			throw new Error(`cannot parse ${this.file}: ${reason(error)}`);
		}
		this._loaded = true;
	}

	get(): Settings {
		if (!this._loaded) throw new Error(`${this.file} has not been loaded — call initialize()`);
		return this._settings;
	}

	async update(patch: Partial<Settings>): Promise<void> {
		this.get();
		const next = { ...this._settings, ...patch };
		await mkdir(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.tmp`;
		await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(tmp, 0o600);
		await rename(tmp, this.file);
		this._settings = next;
	}

	dispose(): void {}
}

export const SettingsServiceId = createServiceId<SettingsService>("SettingsService");
