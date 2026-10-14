/**
 * Open a path in the user's code editor. Detects installed editors (CLI on PATH or app bundle),
 * defaults to VS Code (`code`) when present, and always opens the target as a folder — if the
 * given path is a file, its parent directory is opened instead.
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface EditorInfo {
	id: string;
	name: string;
	cli?: string;
	app?: string;
}

const EDITORS: EditorInfo[] = [
	{ id: "code", name: "VS Code", cli: "code", app: "Visual Studio Code" },
	{ id: "cursor", name: "Cursor", cli: "cursor", app: "Cursor" },
	{ id: "zed", name: "Zed", cli: "zed", app: "Zed" },
	{ id: "windsurf", name: "Windsurf", cli: "windsurf", app: "Windsurf" },
	{ id: "subl", name: "Sublime Text", cli: "subl", app: "Sublime Text" },
];

export function editorNames(): string {
	return EDITORS.map((editor) => editor.name).join(" · ");
}

/** Editors actually installed on this machine (CLI on PATH or app in /Applications). */
export function listInstalledEditors(): EditorInfo[] {
	const installed: EditorInfo[] = [];
	for (const editor of EDITORS) {
		if (editor.cli && Bun.which(editor.cli)) {
			installed.push(editor);
			continue;
		}
		if (editor.app) {
			try {
				if (statSync(`/Applications/${editor.app}.app`).isDirectory()) {
					installed.push(editor);
				}
			} catch {
				// not installed
			}
		}
	}
	return installed;
}

/** Display paths come tildified (e.g. `~/projects/letters`); expand before touching the fs. */
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

/** Whether this machine has the folder browser we know how to call (`/usr/bin/open -a Finder`). */
export const FOLDER_BROWSER_AVAILABLE = process.platform === "darwin";

export type OpenOutcome = { ok: true; via: string } | { ok: false; reason: "missing-path" | "no-editor" | "editor-missing" | "open-failed" };

async function run(argv: string[]): Promise<boolean> {
	try {
		const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "ignore" });
		return (await proc.exited) === 0;
	} catch {
		return false;
	}
}

/** Open the folder in Finder — the OS's own browser, no PATH involved. */
export async function openInFinder(path: string): Promise<OpenOutcome> {
	const real = expandTilde(path);
	if (!existsSync(real)) return { ok: false, reason: "missing-path" };
	const target = folderPath(real);
	return (await run(["/usr/bin/open", "-a", "Finder", target])) ? { ok: true, via: "Finder" } : { ok: false, reason: "open-failed" };
}

/**
 * One attempt must never cancel the next: a GUI-launched app has a bare PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), so an editor found through its app bundle is *not* runnable
 * by its CLI name — and that ENOENT used to swallow the `open -a` fallback that would have worked.
 */
export async function openInCodeEditor(path: string, editorId?: string): Promise<OpenOutcome> {
	const real = expandTilde(path);
	if (!existsSync(real)) return { ok: false, reason: "missing-path" };
	const target = folderPath(real);
	const installed = listInstalledEditors();
	const asked = editorId ? installed.find((editor) => editor.id === editorId) : undefined;
	if (editorId && !asked) return { ok: false, reason: "editor-missing" };
	const pick = asked ?? installed.find((editor) => editor.id === "code") ?? installed[0];

	if (pick?.cli && Bun.which(pick.cli) && (await run([pick.cli, target]))) return { ok: true, via: `${pick.name} cli` };
	if (pick?.app && (await run(["/usr/bin/open", "-a", pick.app, target]))) return { ok: true, via: `${pick.name} app` };
	if (!editorId && (await run(["/usr/bin/open", target]))) return { ok: true, via: "default opener" };

	return { ok: false, reason: pick ? "open-failed" : "no-editor" };
}
