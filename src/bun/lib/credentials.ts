/**
 * LLM api keys — stored apart from settings in ~/.config/letters/.credentials.yaml
 * (mode 0600), keyed by provider id. Settings hold the provider selection only;
 * this file holds the secrets. Loaded once into an in-memory cache at startup
 * (agents resolve keys synchronously); writes update the cache + file together.
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const CREDENTIALS_PATH = join(homedir(), ".config", "letters", ".credentials.yaml");

/** In-memory provider → key cache (the only reader agents see). */
let cache: Record<string, string> = {};

/** Load the file into the cache; missing/corrupt → empty (never crash startup). */
export async function loadCredentials(): Promise<void> {
	try {
		const parsed = parse(await readFile(CREDENTIALS_PATH, "utf8"));
		cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
	} catch {
		cache = {};
	}
}

/** Sync read for agents (resolveModel / credential store) — the cache is loaded before any agent runs. */
export function getApiKey(provider: string): string | undefined {
	return cache[provider];
}

/** Set a provider's key: merge into the file (atomic tmp+rename, mode 0600) and refresh the cache. */
export async function setApiKey(provider: string, key: string): Promise<void> {
	await mkdir(join(homedir(), ".config", "letters"), { recursive: true });
	const merged = { ...cache, [provider]: key };
	await writeCredentialsFile(merged);
	cache = merged;
}

/** Remove a provider's key (removing the provider from settings deletes its secret — no residue). */
export async function deleteApiKey(provider: string): Promise<void> {
	if (!(provider in cache)) return;
	const merged = { ...cache };
	delete merged[provider];
	await writeCredentialsFile(merged);
	cache = merged;
}

async function writeCredentialsFile(credentials: Record<string, string>): Promise<void> {
	await mkdir(join(homedir(), ".config", "letters"), { recursive: true });
	const tmp = `${CREDENTIALS_PATH}.tmp`;
	await writeFile(tmp, stringify(credentials), { encoding: "utf8", mode: 0o600 });
	await chmod(tmp, 0o600);
	await rename(tmp, CREDENTIALS_PATH);
}
