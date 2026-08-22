import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SandboxMode } from "../../shared/rpc";
import { sandboxFilePath } from "./sandbox";
import { getPartnerDir, loadSettings } from "./settings";

// Workspace persistence: per-partner file (survives restart; re-validated on restore).
export const workspaceFilePath = (dir: string) => join(dir, "workspace.json");
export async function persistWorkspace(dir: string, path: string) {
	try {
		await writeFile(workspaceFilePath(dir), JSON.stringify({ path }, null, 2), "utf8");
	} catch (error) {
		console.error("persistWorkspace failed:", error);
	}
}

// Sandbox mode persistence: per-partner file (survives restart; re-validated on restore).
export async function persistSandboxMode(dir: string, mode: SandboxMode) {
	try {
		await writeFile(sandboxFilePath(dir), JSON.stringify({ mode }, null, 2), "utf8");
	} catch (error) {
		console.error("persistSandboxMode failed:", error);
	}
}

// Prompt persistence dedup: the prompt is static, and an in-memory guard resets on every restart
// (one system_prompt appended per launch, piling up identical entries). Record the last persisted
// prompt hash per root on disk so restarts stay silent until the prompt actually changes.
export const lastPromptPath = (dir: string) => join(dir, "last-prompt.json");
const promptHash = (prompt: string) => createHash("sha256").update(prompt).digest("hex");
export async function promptChangedSinceLastPersist(dir: string, prompt: string): Promise<boolean> {
	try {
		const saved = JSON.parse(await readFile(lastPromptPath(dir), "utf8")) as { hash?: unknown };
		return saved.hash !== promptHash(prompt);
	} catch {
		return true; // no record yet (first selection of this root)
	}
}
export async function recordPrompt(dir: string, prompt: string): Promise<void> {
	await writeFile(lastPromptPath(dir), JSON.stringify({ hash: promptHash(prompt) }, null, 2), "utf8");
}

/** The partner's root directory — settings load + name join, the one path every partner op needs. */
export async function partnerDirFor(name: string): Promise<string> {
	const settings = await loadSettings();
	return getPartnerDir(settings, name);
}
