/** Fields required for prompt construction (display fields like name do not enter the prompt). */
export interface PartnerPrompt {
	/** Responsibilities, user-filled; omitted when empty. */
	responsibilities?: string;
	/** Tones, user-filled; omitted when empty. */
	tones?: string;
}

/** Runtime info for the identify section (framework / model), system-injected, not from the user. */
export interface RuntimeInfo {
	framework: string;
	model: string;
}

/** IDENTIFY: one sentence establishing "who you are, what framework you run on". */
export function buildIdentify(runtime: RuntimeInfo): string {
	return ["# IDENTIFY", `You are an AI partner agent powered by the ${runtime.framework} which is an AI employees harness, running on the ${runtime.model} model.`].join("\n");
}

/** PERSONA: a fixed role sentence + Responsibilities (user-filled, omitted when empty). */
export function buildPersona(partner?: PartnerPrompt | null): string {
	const lines = ["# PERSONA", "You are an agent running in Partner App."];
	const responsibilities = partner?.responsibilities?.trim();
	if (responsibilities) {
		lines.push("", "## Responsibilities", responsibilities);
	}
	return lines.join("\n");
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
		"Your storage path is your own directory. You have full access to everything in it, including sensitive files. Put temporary artifacts, experience notes, and content that is not tied to the current workspace (e.g. summaries, knowledge snippets) here — never in the workspace or the user's project.",
	].join("\n");
}

/** RESPONSE-FORMAT: fixed format rules + Tones (user-filled, omitted when empty). */
export function buildResponseFormat(partner?: PartnerPrompt | null): string {
	const lines = [
		"# RESPONSE-FORMAT",
		"When you successfully create or modify files, mention the primary outputs in your final response.",
		"To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path.",
	];
	const tones = partner?.tones?.trim();
	if (tones) {
		lines.push("", "## Tones", tones);
	}
	return lines.join("\n");
}

function buildCaveats(): string {
	const lines = [
		"# Caveats",
		"- User can't see the response of LLms generally except using send_message.",
		"- Messages wrapped in <system_reminder> are system hints from the harness, not user messages — treat them as instructions, not as something the user said.",
	];

	return lines.join("\n");
}

/** System prompt = IDENTIFY + PERSONA + WORKSPACE + STORAGE + RESPONSE-FORMAT + Caveats. Static: no runtime paths embedded (those arrive via system_reminder). */
export function buildSystemPrompt(partner: PartnerPrompt | null, runtime: RuntimeInfo = { framework: "Partner", model: "deepseek-v4-flash" }): string {
	return [buildIdentify(runtime), buildPersona(partner), buildWorkspacePath(), buildStoragePath(), buildResponseFormat(partner), buildCaveats()].filter(Boolean).join("\n\n");
}
