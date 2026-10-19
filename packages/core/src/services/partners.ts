import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The partner's own profile file — v1 writes it, so both versions read one shape. */
export interface PartnerProfile {
	name: string;
	persona?: string;
	createdAt: number;
	forkedFrom?: string;
	pinned?: boolean;
}

export interface PartnerWorkspace {
	path: string;
	kind: "worktree" | "repo" | "dir" | null;
	repo: string | null;
}

const PROFILE_FILE = "profile.json";
const READ_FILE = "read.json";
const WORKSPACE_FILE = "workspace.json";

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

/** Display paths are tildified the way v1 sends them; `open_path` expands them again. */
export function tildify(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function profileOf(dir: string): Promise<PartnerProfile | null> {
	return readJson<PartnerProfile>(join(dir, PROFILE_FILE));
}

export async function readAtOf(dir: string): Promise<number | undefined> {
	const data = await readJson<{ readAt?: unknown }>(join(dir, READ_FILE));
	return typeof data?.readAt === "number" ? data.readAt : undefined;
}

export function writeReadAt(dir: string, readAt: number): Promise<void> {
	return writeJson(join(dir, READ_FILE), { readAt });
}

export async function workspaceOf(dir: string): Promise<PartnerWorkspace | null> {
	const data = await readJson<{ path?: unknown; kind?: unknown; repo?: unknown }>(join(dir, WORKSPACE_FILE));
	if (typeof data?.path !== "string" || !data.path) return null;
	const kind = data.kind === "worktree" || data.kind === "repo" || data.kind === "dir" ? data.kind : null;
	return { path: data.path, kind, repo: typeof data.repo === "string" ? data.repo : null };
}
