/**
 * Per-partner restore-on-first-use: the storage dir, workspace, and sandbox mode a fresh agent
 * needs before its first run (all persisted per partner, all re-validated on restore).
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThinkingLevel } from "../../shared/rpc";
import type { SandboxMode } from "../permission";
import { isSandboxMode, sandboxFilePath, validateWorkspace, workspaceFilePath } from "../permission";
import { modelFilePath, type PartnerModelConfig, persistSandboxMode } from "./partner-files";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && (THINKING_LEVELS as string[]).includes(value);
}

/** Create the partner's storage subdirectory (the agent's freely-writable area) and return its path — it must exist before the prompt mentions it. */
export async function ensureStoragePath(dir: string): Promise<string> {
	const storagePath = join(dir, "storage");
	await mkdir(storagePath, { recursive: true });
	return storagePath;
}

/** Restore the persisted workspace (re-validated so a deleted directory is not restored); null when this partner has none. */
export async function ensureWorkspace(dir: string): Promise<string | null> {
	const storagePath = join(dir, "storage");
	try {
		const raw = await readFile(workspaceFilePath(dir), "utf8");
		const saved = JSON.parse(raw) as { path?: unknown };
		if (typeof saved.path === "string" && validateWorkspace(saved.path, { storagePath }) === null) {
			return saved.path;
		}
	} catch {
		// no persisted workspace for this partner
	}
	return null;
}

export async function hasInvalidPersistedWorkspace(dir: string): Promise<boolean> {
	const storagePath = join(dir, "storage");
	try {
		const raw = await readFile(workspaceFilePath(dir), "utf8");
		const saved = JSON.parse(raw) as { path?: unknown };
		return typeof saved.path === "string" && validateWorkspace(saved.path, { storagePath }) !== null;
	} catch {
		return false;
	}
}

/** Restore the persisted sandbox mode (fallback default when unset or corrupt). */
export async function ensureSandboxMode(dir: string, fallback: SandboxMode = "workspace-write"): Promise<SandboxMode> {
	try {
		const raw = await readFile(sandboxFilePath(dir), "utf8");
		const saved = JSON.parse(raw) as { mode?: unknown };
		if (isSandboxMode(saved.mode)) return saved.mode;
	} catch {
		// no persisted mode for this partner
	}
	// Capture the default at first init so a later settings change doesn't retroactively
	// change partners that never had an explicit mode.
	await persistSandboxMode(dir, fallback);
	return fallback;
}

/** Restore the persisted model selection (provider + optional pinned model + thinking level); null when this partner has none. */
export async function ensureModel(dir: string): Promise<PartnerModelConfig | null> {
	try {
		const raw = await readFile(modelFilePath(dir), "utf8");
		const saved = JSON.parse(raw) as { provider?: unknown; modelId?: unknown; thinkingLevel?: unknown };
		if (typeof saved.provider === "string" && saved.provider) {
			return {
				provider: saved.provider,
				...(typeof saved.modelId === "string" ? { modelId: saved.modelId } : {}),
				...(isThinkingLevel(saved.thinkingLevel) ? { thinkingLevel: saved.thinkingLevel } : {}),
			};
		}
	} catch {
		// no persisted model for this partner
	}
	return null;
}
