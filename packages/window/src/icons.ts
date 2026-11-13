import { createServiceId, type Service } from "@milu/di";
import { createStore } from "zustand/vanilla";

const THEME_ID = /^[a-z0-9][a-z0-9.-]*$/;

export type IconKind = "file" | "directory";

export interface IconTheme {
	readonly id: string;
	readonly title: string;
	readonly file: string;
	readonly directory: string;
	readonly directoryOpen: string;
	readonly glyphs: Readonly<Record<string, string>>;
	readonly extensions?: Readonly<Record<string, string>>;
	readonly names?: Readonly<Record<string, string>>;
	readonly tokens?: Readonly<Record<string, string>>;
}

export interface IconThemeOption {
	readonly value: string;
	readonly label: string;
}

export interface IconsState {
	readonly id: string;
}

const CODE = new Set([
	"c",
	"cc",
	"cpp",
	"css",
	"go",
	"h",
	"html",
	"java",
	"js",
	"jsx",
	"kt",
	"mjs",
	"php",
	"py",
	"rb",
	"rs",
	"sh",
	"swift",
	"ts",
	"tsx",
	"yml",
	"yaml",
	"toml",
	"sql",
	"zsh",
]);
const JSONISH = new Set(["json", "jsonc", "lock"]);
const IMAGES = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const MARKDOWN = new Set(["md", "markdown", "mdx"]);

const STROKE = `xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

const FILE = `<svg ${STROKE}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></svg>`;
const FILE_TEXT = `<svg ${STROKE}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;
const FILE_BRACES = `<svg ${STROKE}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/></svg>`;
const FILE_IMAGE = `<svg ${STROKE}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><circle cx="10" cy="12" r="2"/><path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"/></svg>`;
const FILE_CODE = `<svg ${STROKE}><path d="M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m5 16-3 3 3 3"/><path d="m9 22 3-3-3-3"/></svg>`;
const FOLDER = `<svg ${STROKE}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
const FOLDER_OPEN = `<svg ${STROKE}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`;

function minimalExtensions(): Readonly<Record<string, string>> {
	const map: Record<string, string> = {};
	for (const extension of MARKDOWN) map[extension] = "_file_text";
	for (const extension of JSONISH) map[extension] = "_file_braces";
	for (const extension of IMAGES) map[extension] = "_file_image";
	for (const extension of CODE) map[extension] = "_file_code";
	return map;
}

export const MINIMAL_ICONS: IconTheme = {
	id: "minimal",
	title: "Minimal",
	file: "_file",
	directory: "_folder",
	directoryOpen: "_folder_open",
	glyphs: {
		_file: FILE,
		_file_text: FILE_TEXT,
		_file_braces: FILE_BRACES,
		_file_image: FILE_IMAGE,
		_file_code: FILE_CODE,
		_folder: FOLDER,
		_folder_open: FOLDER_OPEN,
	},
	extensions: minimalExtensions(),
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class IconsService implements Service {
	readonly store = createStore<IconsState>()(() => ({ id: MINIMAL_ICONS.id }));

	private readonly _themes = new Map<string, IconTheme>([[MINIMAL_ICONS.id, MINIMAL_ICONS]]);
	private readonly _applied = new Set<string>();

	initialize(): void {
		this._tokens(MINIMAL_ICONS.tokens ?? {});
	}

	register(theme: IconTheme): void {
		if (!isObject(theme)) throw new Error("an icon theme must be an object");
		if (typeof theme.id !== "string" || !THEME_ID.test(theme.id)) throw new Error(`icon theme id ${JSON.stringify(theme.id)} is not valid`);
		if (this._themes.has(theme.id)) throw new Error(`icon theme "${theme.id}" is already registered`);
		if (typeof theme.title !== "string" || theme.title.trim() === "") throw new Error(`icon theme "${theme.id}" needs a title`);
		if (!isObject(theme.glyphs)) throw new Error(`icon theme "${theme.id}" needs a glyphs object`);
		for (const [key, value] of Object.entries(theme.glyphs)) {
			if (typeof value !== "string" || !value.startsWith("<svg") || !value.endsWith("</svg>")) throw new Error(`icon theme "${theme.id}" glyph "${key}" is not svg markup`);
		}
		for (const key of [theme.file, theme.directory, theme.directoryOpen]) {
			if (theme.glyphs[key] === undefined) throw new Error(`icon theme "${theme.id}" is missing the "${key}" glyph`);
		}
		for (const [key, value] of [...Object.entries(theme.extensions ?? {}), ...Object.entries(theme.names ?? {})]) {
			if (theme.glyphs[value] === undefined) throw new Error(`icon theme "${theme.id}" maps "${key}" to the missing glyph "${value}"`);
		}
		if (theme.tokens !== undefined) {
			for (const [key, value] of Object.entries(theme.tokens)) {
				if (typeof value !== "string" || value.trim() === "") throw new Error(`icon theme "${theme.id}" token "${key}" is not a non-empty string`);
			}
		}
		this._themes.set(theme.id, theme);
	}

	options(): readonly IconThemeOption[] {
		return [...this._themes.values()].map((theme) => ({ value: theme.id, label: theme.title }));
	}

	select(id: string): void {
		const theme = this._themes.get(id);
		if (theme === undefined) return;
		this.store.setState({ id }, true);
		this._tokens(theme.tokens ?? {});
	}

	hydrate(id: string | undefined): void {
		this.select(typeof id === "string" && id !== "" ? id : MINIMAL_ICONS.id);
	}

	resolve(name: string, kind: IconKind, open = false): string {
		return this.glyph(this.store.getState().id, name, kind, open);
	}

	glyph(theme: string, name: string, kind: IconKind, open = false): string {
		const source = this._themes.get(theme) ?? MINIMAL_ICONS;
		if (kind === "directory") return source.glyphs[open ? source.directoryOpen : source.directory] ?? "";
		const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
		const dot = base.lastIndexOf(".");
		const extension = dot > 0 ? base.slice(dot + 1) : "";
		const id = source.names?.[base] ?? (extension === "" ? undefined : source.extensions?.[extension]) ?? source.file;
		return source.glyphs[id] ?? source.glyphs[source.file] ?? "";
	}

	dispose(): void {
		this._tokens({});
		this._themes.clear();
	}

	private _tokens(tokens: Readonly<Record<string, string>>): void {
		const root = document.documentElement;
		for (const name of this._applied) root.style.removeProperty(name);
		this._applied.clear();
		for (const [key, value] of Object.entries(tokens)) {
			const name = `--ctp-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
			root.style.setProperty(name, value);
			this._applied.add(name);
		}
	}
}

export const IIconsService = createServiceId<IconsService>("IconsService");
