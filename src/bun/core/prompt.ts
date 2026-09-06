/** Fields required for prompt construction (display fields like name do not enter the prompt). */
export interface PartnerPrompt {
	/** Persona, user-filled; omitted when empty. */
	persona?: string;
}

/** IDENTIFY: one static sentence establishing who you are — no runtime injection (paths/model arrive per-run or not at all). */
export function buildIdentify(): string {
	return "# IDENTIFY\nYou are a helpful software engineer assistant.";
}

/** PERSONA: the user-filled persona (omitted when empty). The role sentence lives in IDENTIFY — no duplicate identity statement. */
export function buildPersona(partner?: PartnerPrompt | null): string {
	const persona = partner?.persona?.trim();
	if (!persona) return "";
	return `# PERSONA\n\n${persona}`;
}

/**
 * WORKSPACE: the agent's working directory — static text (no embedded path; the path is injected via
 * system_reminder at run start, so the prompt prefix stays stable for KV cache reuse).
 */
export function buildWorkspacePath(): string {
	return [
		"# WORKSPACE",
		"Your workspace is the working directory of the current task. Relative paths you pass to tools — read/write/edit/bash — resolve against it. Sensitive files (e.g. .env, private keys) are off-limits there; use the storage path for those.",
	].join("\n");
}

/**
 * STORAGE: the agent's own storage directory — static text (no embedded path; the path is injected via
 * system_reminder at run start). Full access, including sensitive files.
 */
export function buildStoragePath(): string {
	return [
		"# STORAGE",
		"Your storage path is your own directory. Full access, including sensitive files. Put non-workspace content (temporary artifacts, notes, summaries) here — never in the workspace or the user's project.",
	].join("\n");
}

export function buildSystemPrompt(partner: PartnerPrompt | null): string {
	return [buildIdentify(), buildPersona(partner), buildWorkspacePath(), buildStoragePath()].filter(Boolean).join("\n\n");
}
