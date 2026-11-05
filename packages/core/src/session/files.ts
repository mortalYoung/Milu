import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const PROFILE_FILE = "profile.json";
export const READ_FILE = "read.json";
export const WORKSPACE_FILE = "workspace.json";
export const MODEL_FILE = "model.json";
export const LAST_PROMPT_FILE = "last-prompt.json";
export const SANDBOX_FILE = "sandbox.json";
export const FORKING_FILE = "forking.json";

const promptHash = (prompt: string) => createHash("sha256").update(prompt).digest("hex");

export async function promptChangedSinceLastPersist(dir: string, prompt: string): Promise<boolean> {
	try {
		const saved = JSON.parse(await readFile(join(dir, LAST_PROMPT_FILE), "utf8")) as { hash?: unknown };
		return saved.hash !== promptHash(prompt);
	} catch {
		return true;
	}
}

export async function recordPrompt(dir: string, prompt: string): Promise<void> {
	await writeFile(join(dir, LAST_PROMPT_FILE), JSON.stringify({ hash: promptHash(prompt) }, null, 2), "utf8");
}

export interface SessionProfile {
	name: string;
	persona?: string;
	createdAt: number;
	forkedFrom?: string;
	pinned?: boolean;
}

export interface WorkspaceFacts {
	path: string;
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

export interface SessionModel {
	provider: string;
	modelId?: string;
	thinkingLevel?: string;
}

export function modelOf(dir: string): Promise<SessionModel | null> {
	return readJson<SessionModel>(join(dir, MODEL_FILE));
}

export function writeModel(dir: string, model: SessionModel): Promise<void> {
	return writeJson(join(dir, MODEL_FILE), model);
}

/** While this file exists the session is a copy still being written: it has no log to read yet. */
export function forkingOf(dir: string): Promise<{ from?: unknown } | null> {
	return readJson<{ from?: unknown }>(join(dir, FORKING_FILE));
}

export function markForking(dir: string, from: string): Promise<void> {
	return writeJson(join(dir, FORKING_FILE), { from, startedAt: Date.now() });
}

export async function clearForking(dir: string): Promise<void> {
	await rm(join(dir, FORKING_FILE), { force: true });
}

export function writeProfile(dir: string, profile: SessionProfile): Promise<void> {
	return writeJson(join(dir, PROFILE_FILE), profile);
}

export async function writePinned(dir: string, pinned: boolean): Promise<void> {
	const profile = (await profileOf(dir)) ?? { name: basename(dir), createdAt: Date.now() };
	await writeJson(join(dir, PROFILE_FILE), { ...profile, pinned });
}

export function writeReadAt(dir: string, readAt: number): Promise<void> {
	return writeJson(join(dir, READ_FILE), { readAt });
}

export async function writeWorkspace(dir: string, path: string | null): Promise<void> {
	await writeJson(join(dir, WORKSPACE_FILE), { path });
}

export interface SandboxConfig {
	readonly mode: string | null;
	readonly write: readonly string[];
	readonly cache: string | null;
}

/** v1's per-chat sandbox file: `{ "mode": "…" }`, absent when the chat never had one. */
export async function sandboxOf(dir: string): Promise<SandboxConfig> {
	const data = await readJson<{ mode?: unknown; write?: unknown; cache?: unknown }>(join(dir, SANDBOX_FILE));
	const write = Array.isArray(data?.write) ? data.write.filter((each): each is string => typeof each === "string" && each.trim() !== "") : [];
	return {
		mode: typeof data?.mode === "string" ? data.mode : null,
		write,
		cache: typeof data?.cache === "string" && data.cache.trim() !== "" ? data.cache : null,
	};
}

export async function writeSandbox(dir: string, mode: string): Promise<void> {
	const file = join(dir, SANDBOX_FILE);
	const current = await readJson<Record<string, unknown>>(file);
	await writeJson(file, { ...current, mode });
}

export async function workspaceOf(dir: string): Promise<WorkspaceFacts | null> {
	const data = await readJson<{ path?: unknown }>(join(dir, WORKSPACE_FILE));
	return typeof data?.path === "string" && data.path ? { path: data.path } : null;
}
