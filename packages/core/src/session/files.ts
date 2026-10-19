import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const PROFILE_FILE = "profile.json";
export const READ_FILE = "read.json";
export const WORKSPACE_FILE = "workspace.json";

export interface SessionProfile {
	name: string;
	persona?: string;
	createdAt: number;
	forkedFrom?: string;
	pinned?: boolean;
}

export interface WorkspaceFacts {
	path: string;
	kind: "worktree" | "repo" | "dir" | null;
	repo: string | null;
}

async function readJson<T>(file: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(file, "utf8")) as T;
	} catch {
		return null;
	}
}

async function writeJson(file: string, value: unknown): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(tmp, file);
}

export function tildify(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function profileOf(dir: string): Promise<SessionProfile | null> {
	return readJson<SessionProfile>(join(dir, PROFILE_FILE));
}

export async function readAtOf(dir: string): Promise<number | undefined> {
	const data = await readJson<{ readAt?: unknown }>(join(dir, READ_FILE));
	return typeof data?.readAt === "number" ? data.readAt : undefined;
}

export async function writePinned(dir: string, pinned: boolean): Promise<void> {
	const profile = (await profileOf(dir)) ?? { name: basename(dir), createdAt: Date.now() };
	await writeJson(join(dir, PROFILE_FILE), { ...profile, pinned });
}

export function writeReadAt(dir: string, readAt: number): Promise<void> {
	return writeJson(join(dir, READ_FILE), { readAt });
}

export async function workspaceOf(dir: string): Promise<WorkspaceFacts | null> {
	const data = await readJson<{ path?: unknown; kind?: unknown; repo?: unknown }>(join(dir, WORKSPACE_FILE));
	if (typeof data?.path !== "string" || !data.path) return null;
	const kind = data.kind === "worktree" || data.kind === "repo" || data.kind === "dir" ? data.kind : null;
	return { path: data.path, kind, repo: typeof data.repo === "string" ? data.repo : null };
}
