import { createServiceId, type Service } from "@milu/di";
import type { Theme, ThemeAppearance, ThemeMode, ThemeSettings, ThemeState, ThemeTokens } from "@milu/protocol";
import { createStore } from "zustand/vanilla";

const CACHE_KEY = "milu.theme";

const DEFAULT_SETTINGS: ThemeSettings = { mode: "system", light: "light", dark: "dark" };

export interface ThemeSnapshot {
	readonly mode: ThemeMode;
	readonly appearance: ThemeAppearance;
	readonly theme: string;
	readonly settings: ThemeSettings;
}

export interface ThemeOption {
	readonly value: string;
	readonly label: string;
}

const BASE_SWATCH: Record<ThemeAppearance, readonly [string, string, string]> = {
	light: ["#faf9f5", "#141413", "#2f7a6b"],
	dark: ["#181715", "#faf9f5", "#5db8a6"],
};

interface CachedTheme {
	readonly mode: ThemeMode;
	readonly appearance: ThemeAppearance;
	readonly theme: string;
	readonly tokens: ThemeTokens;
}

function variable(key: string): string {
	return `--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: unknown): ThemeSettings {
	const record = isObject(value) ? value : {};
	const mode = record["mode"];
	const light = record["light"];
	const dark = record["dark"];
	return {
		mode: mode === "light" || mode === "dark" ? mode : "system",
		light: typeof light === "string" ? light : "light",
		dark: typeof dark === "string" ? dark : "dark",
	};
}

function readCache(): CachedTheme | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (raw === null) return null;
		const value: unknown = JSON.parse(raw);
		if (!isObject(value)) return null;
		const appearance = value["appearance"];
		if (appearance !== "light" && appearance !== "dark") return null;
		const mode = value["mode"];
		const theme = value["theme"];
		const tokens = value["tokens"];
		return {
			mode: mode === "light" || mode === "dark" ? mode : "system",
			appearance,
			theme: typeof theme === "string" ? theme : "",
			tokens: isObject(tokens) ? (tokens as ThemeTokens) : {},
		};
	} catch {
		return null;
	}
}

function writeCache(cache: CachedTheme): void {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
	} catch {
		return;
	}
}

export class ThemeService implements Service {
	readonly store = createStore<ThemeSnapshot>()(() => ({
		mode: "system",
		appearance: "light",
		theme: "light",
		settings: DEFAULT_SETTINGS,
	}));

	private readonly _themes = new Map<string, Theme>();
	private readonly _applied = new Set<string>();
	private readonly _media = window.matchMedia("(prefers-color-scheme: dark)");
	private readonly _onSystemChange = (): void => {
		if (this._settings.mode === "system") this.apply();
	};
	private _settings: ThemeSettings = DEFAULT_SETTINGS;

	initialize(): void {
		const cached = readCache();
		if (cached !== null) this._paint(cached.mode, cached.appearance, cached.theme, cached.tokens);
		this._media.addEventListener("change", this._onSystemChange);
	}

	hydrate(state: ThemeState | undefined): void {
		if (state === undefined) return;
		this._themes.clear();
		for (const theme of state.themes) this._themes.set(theme.id, theme);
		const settings = normalize(state.settings);
		this._settings = {
			mode: settings.mode,
			light: this._themes.get(settings.light)?.appearance === "light" ? settings.light : "light",
			dark: this._themes.get(settings.dark)?.appearance === "dark" ? settings.dark : "dark",
		};
		this.apply();
	}

	settings(): ThemeSettings {
		return this._settings;
	}

	themes(appearance: ThemeAppearance): readonly Theme[] {
		return [...this._themes.values()].filter((theme) => theme.appearance === appearance);
	}

	options(appearance: ThemeAppearance): readonly ThemeOption[] {
		return this.themes(appearance).map((theme) => ({ value: theme.id, label: theme.name }));
	}

	swatch(appearance: ThemeAppearance, id: string): readonly [string, string, string] {
		const base = BASE_SWATCH[appearance];
		const theme = this._themes.get(id);
		if (theme === undefined || theme.appearance !== appearance) return base;
		return [theme.tokens.canvas ?? base[0], theme.tokens.ink ?? base[1], theme.tokens.accentTeal ?? base[2]];
	}

	select(patch: Partial<ThemeSettings>): void {
		this._settings = { ...this._settings, ...patch };
		this.apply();
	}

	resolve(mode: ThemeMode = this._settings.mode): ThemeAppearance {
		if (mode !== "system") return mode;
		return this._media.matches ? "dark" : "light";
	}

	apply(): void {
		const appearance = this.resolve();
		const id = appearance === "light" ? this._settings.light : this._settings.dark;
		const theme = this._themes.get(id);
		const matched = theme?.appearance === appearance ? theme : undefined;
		const tokens = matched?.tokens ?? {};
		const effective = matched?.id ?? id;
		this._paint(this._settings.mode, appearance, effective, tokens);
		if (this._themes.size > 0) writeCache({ mode: this._settings.mode, appearance, theme: effective, tokens });
		this.store.setState({ mode: this._settings.mode, appearance, theme: effective, settings: this._settings }, true);
	}

	dispose(): void {
		this._media.removeEventListener("change", this._onSystemChange);
		this._clear();
		const root = document.documentElement;
		delete root.dataset["mode"];
		delete root.dataset["appearance"];
		delete root.dataset["theme"];
		root.style.removeProperty("color-scheme");
	}

	private _paint(mode: ThemeMode, appearance: ThemeAppearance, theme: string, tokens: ThemeTokens): void {
		this._clear();
		const root = document.documentElement;
		for (const [key, value] of Object.entries(tokens)) {
			const name = variable(key);
			root.style.setProperty(name, value);
			this._applied.add(name);
		}
		root.style.colorScheme = appearance;
		root.dataset["mode"] = mode;
		root.dataset["appearance"] = appearance;
		root.dataset["theme"] = theme;
	}

	private _clear(): void {
		const root = document.documentElement;
		for (const name of this._applied) root.style.removeProperty(name);
		this._applied.clear();
	}
}

export const IThemeService = createServiceId<ThemeService>("ThemeService");
