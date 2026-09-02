/**
 * Open a path in the user's code editor. Detects installed editors (CLI on PATH or app bundle),
 * defaults to VS Code (`code`) when present, and always opens the target as a folder — if the
 * given path is a file, its parent directory is opened instead.
 */
import { statSync } from "node:fs";
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
	const real = expandTilde(path);
	try {
		return statSync(real).isDirectory() ? real : dirname(real);
	} catch {
		return real;
	}
}

export async function openInCodeEditor(path: string, editorId?: string): Promise<boolean> {
	const target = folderPath(path);
	const installed = listInstalledEditors();
	const pick = installed.find((e) => e.id === editorId) ?? installed.find((e) => e.id === "code") ?? installed[0];
	if (!pick) {
		// Last resort: the OS default opener.
		try {
			const proc = Bun.spawn(["/usr/bin/open", target], { stdout: "ignore", stderr: "ignore" });
			return (await proc.exited) === 0;
		} catch {
			return false;
		}
	}
	try {
		if (pick.cli) {
			const proc = Bun.spawn([pick.cli, target], { stdout: "ignore", stderr: "ignore" });
			if ((await proc.exited) === 0) return true;
		}
		if (pick.app) {
			const proc = Bun.spawn(["/usr/bin/open", "-a", pick.app, target], { stdout: "ignore", stderr: "ignore" });
			if ((await proc.exited) === 0) return true;
		}
	} catch {
		// try the next fallback below
	}
	return false;
}
