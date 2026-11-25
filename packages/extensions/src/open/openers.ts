import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export interface Editor {
	readonly id: string;
	readonly name: string;
	readonly cli?: string;
	readonly app?: string;
	readonly icon: string;
}

export type OpenOutcome = { ok: true; via: string } | { ok: false; reason: "missing-path" | "no-editor" | "editor-missing" | "open-failed" };

const EDITORS: Editor[] = [
	{ id: "code", name: "VS Code", cli: "code", app: "Visual Studio Code", icon: "vscode" },
	{ id: "cursor", name: "Cursor", cli: "cursor", app: "Cursor", icon: "cursor" },
	{ id: "zed", name: "Zed", cli: "zed", app: "Zed", icon: "zed" },
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

const ICONS = new Map<string, Promise<string | null>>();

function tool(file: string, args: readonly string[]): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(file, [...args], { timeout: 5000 }, (error, stdout) => resolve(error ? null : stdout));
	});
}

async function iconOf(bundle: string): Promise<string | null> {
	const resources = join(bundle, "Contents", "Resources");
	let name: string | null = null;
	const plist = await tool("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(bundle, "Contents", "Info.plist")]);
	if (plist !== null) {
		try {
			const declared = (JSON.parse(plist) as { CFBundleIconFile?: unknown }).CFBundleIconFile;
			if (typeof declared === "string" && declared !== "") name = declared.endsWith(".icns") ? declared : `${declared}.icns`;
		} catch {}
	}
	if (name === null) {
		try {
			name = (await readdir(resources)).find((entry) => entry.endsWith(".icns")) ?? null;
		} catch {
			return null;
		}
	}
	if (name === null) return null;
	const dir = await mkdtemp(join(tmpdir(), "milu-icon-"));
	try {
		const out = join(dir, "icon.png");
		if ((await tool("/usr/bin/sips", ["-s", "format", "png", "-Z", "64", join(resources, name), "--out", out])) === null) return null;
		return `data:image/png;base64,${(await readFile(out)).toString("base64")}`;
	} catch {
		return null;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function bundleOf(app: string): string | null {
	for (const root of ["/Applications", join(homedir(), "Applications")]) {
		const bundle = join(root, `${app}.app`);
		if (existsSync(bundle)) return bundle;
	}
	return null;
}

function cached(bundle: string | null): Promise<string | null> {
	if (bundle === null) return Promise.resolve(null);
	const hit = ICONS.get(bundle);
	if (hit !== undefined) return hit;
	const pending = iconOf(bundle);
	ICONS.set(bundle, pending);
	return pending;
}

export function editorIcon(editor: Editor): Promise<string | null> {
	return cached(editor.app === undefined ? null : bundleOf(editor.app));
}

export function finderIcon(): Promise<string | null> {
	return cached("/System/Library/CoreServices/Finder.app");
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

export async function openFileInEditor(path: string, line?: number): Promise<OpenOutcome> {
	const real = expandTilde(path);
	if (!existsSync(real)) return { ok: false, reason: "missing-path" };
	const installed = listInstalledEditors();
	const pick = installed.find((editor) => editor.id === "code") ?? installed[0];
	const target = line === undefined ? real : `${real}:${line}`;

	if (pick?.cli && which(pick.cli) && (await run(line === undefined ? [pick.cli, real] : [pick.cli, "-g", target]))) return { ok: true, via: `${pick.name} cli` };
	if (pick?.app && (await run(["/usr/bin/open", "-a", pick.app, real]))) return { ok: true, via: `${pick.name} app` };
	if (await run(["/usr/bin/open", real])) return { ok: true, via: "default opener" };
	return { ok: false, reason: pick ? "open-failed" : "no-editor" };
}
