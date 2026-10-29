import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { createServiceId, type Disposable, Emitter, type Event, type Service } from "@milu/di";

import { IConfigService } from "./config.ts";
import type { ConfigService } from "./config.ts";

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

export interface DefaultModel {
	provider: string;
	modelId?: string;
}

export interface Settings {
	partner_profile_path: string;
	defaultModel?: DefaultModel;
	providers?: string[];
	customProviders?: CustomProvider[];
	theme?: ThemeMode;
	rememberSession?: boolean;
	commands_path?: string;
	compaction?: {
		thresholdRatio?: number;
		digestMaxItems?: number;
		maxOverflowRetries?: number;
		prune?: { thresholdChars?: number; headChars?: number; tailChars?: number };
	};
	explorer?: { lineGap?: number; fold?: { braces?: boolean; markdown?: boolean } };
	highlight?: { tokenizeMaxLineLength?: number; tokenizeTimeLimit?: number };
}

export function expandHome(value: string): string {
	return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}

function defaults(root: string): Settings {
	return {
		partner_profile_path: "~/.partner/",
		commands_path: join(root, "commands"),
		theme: "system",
		rememberSession: true,
		explorer: { lineGap: 0.2, fold: { braces: true, markdown: true } },
		highlight: { tokenizeMaxLineLength: 3000, tokenizeTimeLimit: 500 },
		compaction: { digestMaxItems: 10 },
	};
}

function isSectionObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SettingsPoint<T> implements Disposable {
	private _closed = false;

	constructor(
		private readonly _settingsService: SettingsService,
		readonly key: string,
		private readonly _defaults: T,
	) {}

	get(): T {
		if (this._closed) throw new Error(`settings "${this.key}" is no longer declared`);
		const value = (this._settingsService.get() as unknown as Record<string, unknown>)[this.key];
		if (value === undefined) return this._defaults;
		if (isSectionObject(value) && isSectionObject(this._defaults)) return { ...this._defaults, ...value } as T;
		return value as T;
	}

	dispose(): void {
		this._closed = true;
	}
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
	readonly onChange: Event<Readonly<Record<string, unknown>>>;

	private _settings: Settings;
	private readonly _base: Settings;
	private _loaded = false;
	private readonly _changed = new Emitter<Readonly<Record<string, unknown>>>();
	private readonly _declared = new Map<string, unknown>();

	constructor(@IConfigService private readonly _configService: ConfigService) {
		this.file = join(this._configService.root, "settings.json");
		this.onChange = this._changed.event;
		this._base = defaults(this._configService.root);
		this._settings = this._base;
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

	declare<T>(section: { readonly key: string; readonly defaults: T }): SettingsPoint<T> {
		this.get();
		if (this._declared.has(section.key)) throw new Error(`settings "${section.key}" is already declared`);
		this._declared.set(section.key, section.defaults);
		return new SettingsPoint(this, section.key, section.defaults);
	}

	defaults(): Readonly<Record<string, unknown>> {
		return { ...this._base, ...Object.fromEntries(this._declared) };
	}

	async update(patch: Partial<Settings> | Readonly<Record<string, unknown>>): Promise<void> {
		this.get();
		const next = { ...this._settings, ...patch } as Settings;
		await mkdir(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.tmp`;
		await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(tmp, 0o600);
		await rename(tmp, this.file);
		this._settings = next;
		this._changed.fire(next as unknown as Readonly<Record<string, unknown>>);
	}

	dispose(): void {
		this._declared.clear();
		this._changed.dispose();
	}
}

export const ISettingsService = createServiceId<SettingsService>("SettingsService");
