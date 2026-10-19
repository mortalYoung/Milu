import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export interface Editor {
	readonly id: string;
	readonly name: string;
	readonly cli?: string;
	readonly app?: string;
}

export type OpenOutcome = { ok: true; via: string } | { ok: false; reason: "missing-path" | "no-editor" | "editor-missing" | "open-failed" };

const EDITORS: Editor[] = [
	{ id: "code", name: "VS Code", cli: "code", app: "Visual Studio Code" },
	{ id: "cursor", name: "Cursor", cli: "cursor", app: "Cursor" },
	{ id: "zed", name: "Zed", cli: "zed", app: "Zed" },
	{ id: "windsurf", name: "Windsurf", cli: "windsurf", app: "Windsurf" },
	{ id: "subl", name: "Sublime Text", cli: "subl", app: "Sublime Text" },
];

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

export function listInstalledEditors(): Editor[] {
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

function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}

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

export async function openInFinder(path: string): Promise<OpenOutcome> {
	const real = expandTilde(path);
	if (!existsSync(real)) return { ok: false, reason: "missing-path" };
	return (await run(["/usr/bin/open", "-a", "Finder", folderPath(real)])) ? { ok: true, via: "Finder" } : { ok: false, reason: "open-failed" };
}

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
