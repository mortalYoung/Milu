/**
 * System prompt construction — IDENTIFY / PERSONA / TOOL-GUIDANCE / RESPONSE-FORMAT (+ optional STORAGE).
 * Conventions:
 * - IDENTIFY: one sentence establishing "who you are, what framework you run on" (framework + model, system-injected, not editable).
 * - PERSONA: the task role. role is required (role phrase, e.g. "Front-End Programmer"); when role is missing (no
 *   Partner selected) the whole section is omitted. Responsibilities is user-filled, no default; empty means the part is omitted.
 * - TOOL-GUIDANCE: per-tool "how to use this tool correctly" guidance, dynamically inserted from the tool guidance table;
 *   tools without guidance fall back to a name — description list.
 * - RESPONSE-FORMAT: final response format constraints (fixed rules) + Tones (user-filled, no default; empty means omitted).
 * - STORAGE (optional, appended last): the agent's own storage directory — an epistemic guardrail that makes explicit
 *   where it may freely persist work, so it never guesses or scatters files elsewhere.
 * System prompt = IDENTIFY + PERSONA + TOOL-GUIDANCE + RESPONSE-FORMAT (+ STORAGE).
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";

/** Fields required for prompt construction (role required; display fields like name/avatar do not enter the prompt). */
export interface PartnerPrompt {
	/** Role phrase (e.g. "Front-End Programmer"), required. */
	role?: string;
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

/** Tool usage guidance table: one "how to use this tool correctly" entry per tool. */
export type ToolGuidance = Record<string, string>;

/** IDENTIFY: one sentence establishing "who you are, what framework you run on". */
export function buildIdentify(runtime: RuntimeInfo): string {
	return ["# IDENTIFY", `You are an AI partner agent powered by the ${runtime.framework} which is an AI employees harness, running on the ${runtime.model} model.`].join("\n");
}

/** PERSONA: role sentence + Responsibilities (user-filled, omitted when empty). role is required; the whole section is omitted when it is missing. */
export function buildPersona(partner?: PartnerPrompt | null): string {
	const role = partner?.role?.trim();
	if (!role) return "";
	const lines = ["# PERSONA", `You are a ${role}.`];
	const responsibilities = partner?.responsibilities?.trim();
	if (responsibilities) {
		lines.push("", "## Responsibilities", responsibilities);
	}
	return lines.join("\n");
}

/** TOOL-GUIDANCE: per-tool "how to use it correctly"; tools without guidance fall back to a name — description list. */
export function buildToolGuidance(tools: AgentTool[] = [], guidance: ToolGuidance = {}): string {
	const entries = tools.map((t) => (guidance[t.name] ? `- ${t.name}: ${guidance[t.name]}` : `- ${t.name} — ${t.description}`));
	return ["# TOOL-GUIDANCE", ...entries].join("\n");
}

/** STORAGE: the agent's own storage directory — epistemic guardrail, explicit so the model never guesses where it may persist work. */
export function buildStoragePath(storagePath: string): string {
	return [
		"# STORAGE",
		`Your storage path is ${storagePath}.`,
		"This directory is yours: create, read, write, or delete anything under it to persist notes, scratch files, and artifacts across sessions. Use it instead of scattering files in the project.",
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
	const lines = ["# Caveats", "- User can't see the response of LLms generally except using send_message."];

	return lines.join("\n");
}

/** System prompt = IDENTIFY + PERSONA + TOOL-GUIDANCE + RESPONSE-FORMAT. */
export function buildSystemPrompt(
	partner: PartnerPrompt | null,
	tools: AgentTool[] = [],
	guidance: ToolGuidance = {},
	runtime: RuntimeInfo = { framework: "Partner", model: "deepseek-v4-flash" },
	storagePath?: string | null,
): string {
	const sections = [buildIdentify(runtime), buildPersona(partner), buildToolGuidance(tools, guidance), buildResponseFormat(partner), buildCaveats()];
	if (storagePath) sections.push(buildStoragePath(storagePath));
	return sections.filter(Boolean).join("\n\n");
}
