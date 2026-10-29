import { createServiceId, type Disposable, type Service } from "@milu/di";
import { THEME_TOKEN_KEYS, type Theme } from "@milu/protocol";

const THEME_ID = /^[a-z0-9][a-z0-9.-]*$/;

interface Entry {
	readonly theme: Theme;
	readonly extension: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ThemesService implements Service {
	private readonly _themes = new Map<string, Entry>();
	private _closed = false;

	list(): readonly Theme[] {
		return [...this._themes.values()].map((entry) => entry.theme);
	}

	register(extension: string, theme: Theme): Disposable {
		if (this._closed) throw new Error("the theme registry is closed");
		if (!isObject(theme)) throw new Error("a theme must be an object");
		if (typeof theme.id !== "string" || !THEME_ID.test(theme.id)) throw new Error(`theme id ${JSON.stringify(theme.id)} is not valid`);
		if (theme.id === "system") throw new Error('theme id "system" is reserved for the appearance mode');
		if (typeof theme.name !== "string" || theme.name.trim() === "") throw new Error(`theme "${theme.id}" needs a name`);
		if (theme.appearance !== "light" && theme.appearance !== "dark") throw new Error(`theme "${theme.id}" needs an appearance of "light" or "dark"`);
		if (!isObject(theme.tokens)) throw new Error(`theme "${theme.id}" needs a tokens object`);
		for (const [key, value] of Object.entries(theme.tokens)) {
			if (!(THEME_TOKEN_KEYS as readonly string[]).includes(key)) throw new Error(`theme "${theme.id}" has an unknown token "${key}"`);
			if (typeof value !== "string" || value.trim() === "") throw new Error(`theme "${theme.id}" token "${key}" is not a non-empty string`);
		}
		const existing = this._themes.get(theme.id);
		if (existing !== undefined) throw new Error(`theme "${theme.id}" is already registered by "${existing.extension}"`);
		this._themes.set(theme.id, { theme, extension });
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				if (this._themes.get(theme.id)?.extension === extension) this._themes.delete(theme.id);
			},
		};
	}

	dispose(): void {
		this._closed = true;
		this._themes.clear();
	}
}

export const IThemesService = createServiceId<ThemesService>("ThemesService");
