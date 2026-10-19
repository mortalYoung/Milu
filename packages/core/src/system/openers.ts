import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export interface EditorInfo {
	id: string;
	name: string;
	cli?: string;
	app?: string;
}

export interface EditorTarget {
	id: string;
	name: string;
}

export interface OpenTargets {
	editors: EditorTarget[];
	finder: boolean;
}

/** The editors v1 knew about; anything not installed is simply not offered. */
const EDITORS: EditorInfo[] = [
	{ id: "code", name: "VS Code", cli: "code", app: "Visual Studio Code" },
	{ id: "cursor", name: "Cursor", cli: "cursor", app: "Cursor" },
	{ id: "zed", name: "Zed", cli: "zed", app: "Zed" },
	{ id: "windsurf", name: "Windsurf", cli: "windsurf", app: "Windsurf" },
	{ id: "subl", name: "Sublime Text", cli: "subl", app: "Sublime Text" },
];

export const FOLDER_BROWSER_AVAILABLE = process.platform === "darwin";

/** No Bun.which: the core has to run under any Node, so PATH is walked by hand. */
function which(command: string): string | null {
	for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

export function listInstalledEditors(): EditorInfo[] {
	return EDITORS.filter((editor) => {
		if (editor.cli && which(editor.cli)) return true;
		if (!editor.app) return false;
		try {
			return statSync(`/Applications/${editor.app}.app`).isDirectory();
		} catch {
			return false;
		}
	});
}

export function openTargets(): OpenTargets {
	return { editors: listInstalledEditors().map(({ id, name }) => ({ id, name })), finder: FOLDER_BROWSER_AVAILABLE };
}

function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}

/** These buttons always open a folder: a file target falls back to its parent directory. */
function folderPath(path: string): string {
	try {
		return statSync(path).isDirectory() ? path : dirname(path);
	} catch {
		return path;
	}
}

function run(argv: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const child = spawn(argv[0] ?? "", argv.slice(1), { stdio: "ignore", detached: true });
			child.once("error", () => resolve(false));
			child.once("exit", (code) => resolve(code === 0));
			child.unref();
		} catch {
			resolve(false);
		}
	});
}

export type OpenOutcome = { ok: true; via: string } | { ok: false; reason: "missing-path" | "no-editor" | "editor-missing" | "open-failed" };

export async function openInFinder(path: string): Promise<OpenOutcome> {
	const real = expandTilde(path);
	if (!existsSync(real)) return { ok: false, reason: "missing-path" };
	return (await run(["/usr/bin/open", "-a", "Finder", folderPath(real)])) ? { ok: true, via: "Finder" } : { ok: false, reason: "open-failed" };
}

/**
 * One attempt must never cancel the next: a GUI-launched app has a bare PATH, so an editor found
 * through its bundle is not runnable by its CLI name — and that failure used to swallow the
 * `open -a` fallback that would have worked.
 */
export async function openInCodeEditor(path: string, editorId?: string): Promise<OpenOutcome> {
	const real = expandTilde(path);
	if (!existsSync(real)) return { ok: false, reason: "missing-path" };
	const target = folderPath(real);
	const installed = listInstalledEditors();
	const asked = editorId ? installed.find((editor) => editor.id === editorId) : undefined;
	if (editorId && !asked) return { ok: false, reason: "editor-missing" };
	const pick = asked ?? installed.find((editor) => editor.id === "code") ?? installed[0];

	if (pick?.cli && which(pick.cli) && (await run([pick.cli, target]))) return { ok: true, via: `${pick.name} cli` };
	if (pick?.app && (await run(["/usr/bin/open", "-a", pick.app, target]))) return { ok: true, via: `${pick.name} app` };
	if (!editorId && (await run(["/usr/bin/open", target]))) return { ok: true, via: "default opener" };
	return { ok: false, reason: pick ? "open-failed" : "no-editor" };
}

export function editorNames(): string {
	return EDITORS.map((editor) => editor.name).join(" · ");
}
