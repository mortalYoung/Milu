export interface PartnerPrompt {
	persona?: string;
}

export function buildIdentify(): string {
	return "# IDENTIFY\nYou are a helpful software engineer assistant.";
}

export function buildPersona(partner?: PartnerPrompt | null): string {
	const persona = partner?.persona?.trim();
	if (!persona) return "";
	return `# PERSONA\n\n${persona}`;
}

export function buildWorkspacePath(): string {
	return [
		"# WORKING DIRECTORY",
		"When a working directory is set, relative paths you pass to read/write/edit/bash resolve against it, and bash starts there. When it is not set, bash runs in your storage scratch directory and file tools require absolute paths. Sensitive files (e.g. .env, private keys) are off-limits in the working directory; use the storage path for those.",
	].join("\n");
}

export function buildStoragePath(): string {
	return [
		"# STORAGE",
		"Your storage path is your own directory. Full access, including sensitive files. Keep temporary artifacts, notes, and summaries here — never in the working directory or the user's project.",
	].join("\n");
}

export function buildSystemPrompt(partner: PartnerPrompt | null): string {
	return [buildIdentify(), buildPersona(partner), buildWorkspacePath(), buildStoragePath()].filter(Boolean).join("\n\n");
}
