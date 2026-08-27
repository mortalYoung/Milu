import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThinkingLevel } from "../../shared/rpc";
import type { SandboxMode } from "../permission";
import { sandboxFilePath, workspaceFilePath } from "../permission";
import { getPartnerDir, loadSettings } from "./settings";

// Workspace persistence: per-partner file (survives restart; re-validated on restore).
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

export interface PartnerModelConfig {
	provider: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
}

// Read watermark persistence: per-partner file (survives restart); unread = lastMessageAt > readAt.
export const readFilePath = (dir: string) => join(dir, "read.json");
export async function readPartnerReadAt(dir: string): Promise<number> {
	try {
		const saved = JSON.parse(await readFile(readFilePath(dir), "utf8")) as { readAt?: unknown };
		return typeof saved.readAt === "number" && Number.isFinite(saved.readAt) ? saved.readAt : 0;
	} catch {
		return 0;
	}
}
export async function persistPartnerReadAt(dir: string, readAt: number): Promise<void> {
	try {
		await writeFile(readFilePath(dir), JSON.stringify({ readAt }, null, 2), "utf8");
	} catch (error) {
		console.error("persistPartnerReadAt failed:", error);
	}
}

// Per-partner model selection (provider + pinned model + thinking level): survives restart, restored on partner switch.
export const modelFilePath = (dir: string) => join(dir, "model.json");
export async function persistModel(dir: string, model: PartnerModelConfig) {
	try {
		await writeFile(modelFilePath(dir), JSON.stringify(model, null, 2), "utf8");
	} catch (error) {
		console.error("persistModel failed:", error);
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
