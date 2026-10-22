import type { Extension, Session } from "@milu/core";

export function buildIdentify(): string {
	return "# IDENTIFY\nYou are a helpful software engineer assistant.";
}

export function buildPersona(persona?: string): string {
	const text = persona?.trim();
	if (!text) return "";
	return `# PERSONA\n\n${text}`;
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

async function personaOf(session: Session): Promise<string> {
	return buildPersona((await session.profile())?.persona);
}

export const promptExtension: Extension = {
	id: "prompt",
	apiVersion: 1,

	contributions: {
		"system.prompt": [
			{ id: "identity", order: 10, text: buildIdentify() },
			{ id: "persona", order: 20, text: (session: Session) => personaOf(session) },
			{ id: "workspace", order: 30, text: buildWorkspacePath() },
			{ id: "storage", order: 40, text: buildStoragePath() },
		],
	},
};
