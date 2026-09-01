import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { RequestTool } from "../../shared/rpc";
import type { SurfaceNode } from "../../shared/surface";
import { EVENTS } from "../persist/events";
import { convertToLlm, STREAM_FN } from "./agent-config";
import { deriveEventMessage } from "./surface";

export interface SummarizeInput {
	entries: Entry[];
	shadowed: SurfaceNode[];
	systemPrompt: string;
	tools: RequestTool[];
	model?: Model<any>;
	capChars: number;
}

export interface Summarizer {
	summarize(input: SummarizeInput): Promise<string>;
}

const COMPACTION_INSTRUCTION = [
	"You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.",
	'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
	"## Primary Request and Intent",
	"- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
	"## Key Technical Concepts",
	"- [technologies, frameworks, patterns, and conventions in play]",
	"## Files and Code",
	"- [exact path: why it matters, key changes or snippets]",
	"## Errors and Fixes",
	"- [error: how it was resolved, plus any related user feedback]",
	"## Pending Jobs",
	"- [explicitly requested work not yet completed]",
	"## Current Work",
	"- [precisely what was in progress at this checkpoint]",
	"## Next Step",
	'- [the single next action, directly in line with the most recent request, or "(none)"]',
	"## Critical Context",
	"- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]",
	"Rules:",
	"- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.",
	"- Capture user feedback and explicit instructions faithfully, especially corrections.",
	"- Do NOT mention this summarization request or that the context was compacted.",
	"- Output only the checkpoint text: do not call any tool or take any other action.",
	"- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.",
].join("\n");

export function frameSummary(summary: string, previousCheckpoint?: string): string {
	const preamble =
		"This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";
	if (previousCheckpoint) {
		// The previous checkpoint is the only stable provider-prefix anchor: keep it verbatim
		// at the front so the next request's [system][previous checkpoint] prefix still cache-hits.
		return [previousCheckpoint, "", preamble, "", "<compacted-summary>", summary, "</compacted-summary>"].join("\n");
	}
	return [preamble, "", "<compacted-summary>", summary, "</compacted-summary>"].join("\n");
}

/** The previous checkpoint among the shadowed span, if any (used as the new checkpoint's cache anchor). */
export function previousCheckpointText(entries: Entry[], shadowed: SurfaceNode[]): string | undefined {
	const byId = new Map(entries.map((e) => [e.id, e]));
	for (const node of shadowed) {
		const entry = byId.get(node.id);
		if (!entry || entry.type !== "custom" || entry.customType !== EVENTS.compactionSummary) continue;
		const data = (entry.data ?? {}) as { text?: unknown };
		if (typeof data.text === "string" && data.text.length > 0) return data.text;
	}
	return undefined;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function textOf(entry: Entry): string {
	if (entry.type === "message") {
		const m = entry.message;
		if (m.role === "user") return typeof m.content === "string" ? m.content : contentText(m.content);
		if (m.role === "assistant") return contentText(m.content);
		return "";
	}
	if (entry.type === "custom") {
		const data = entry.data as { text?: unknown; content?: unknown };
		if (typeof data.text === "string") return data.text;
		if (entry.customType === "tool/result") return contentText(data.content);
		return "";
	}
	return "";
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b) => {
			const block = b as { type?: unknown; text?: unknown } | null;
			if (!block) return "";
			if (block.type === "text") return String(block.text ?? "");
			return "";
		})
		.join("\n");
}

function isCheckpoint(text: string): boolean {
	return text.includes("<compacted-summary>") || text.startsWith("[compacted ");
}

function replayLines(entries: Entry[], shadowed: SurfaceNode[]): string[] {
	const byId = new Map(entries.map((e) => [e.id, e]));
	const lines: string[] = [];
	for (const node of shadowed) {
		const entry = byId.get(node.id);
		if (!entry) continue;
		const raw = textOf(entry);
		if (!raw) continue;
		const text = oneLine(raw).slice(0, 80);
		if (isCheckpoint(raw)) {
			// The previous checkpoint is preserved verbatim as the cache anchor by planCompaction;
			// do not duplicate it inside the condensed replay body.
			continue;
		}
		if (node.kind === "user") lines.push(`Q: ${text}`);
		else if (node.kind === "send_message") lines.push(`A: ${text}`);
		else if (node.kind === "tool_result") lines.push(`[tool] ${text}`);
	}
	return lines;
}

function compactLocal(lines: string[], capChars: number): string {
	const joined = lines.join("\n");
	if (joined.length <= capChars) return joined;
	return joined.slice(0, capChars) + "\n…";
}

export const localSummarizer: Summarizer = {
	async summarize({ entries, shadowed, capChars }) {
		return compactLocal(replayLines(entries, shadowed), capChars);
	},
};

export function buildSummarizationInput(entries: Entry[], shadowed: SurfaceNode[]): { messages: AgentMessage[] } {
	const replay: AgentMessage[] = [];
	const byId = new Map(entries.map((e) => [e.id, e]));
	for (const node of shadowed) {
		const entry = byId.get(node.id);
		if (!entry) continue;
		const message = deriveEventMessage(entry);
		if (message) replay.push(message);
	}
	replay.push({ role: "user", content: COMPACTION_INSTRUCTION, timestamp: Date.now() } as AgentMessage);
	return { messages: replay };
}

export function createLlmSummarizer(): Summarizer {
	return {
		async summarize({ entries, shadowed, systemPrompt, tools, model, capChars }) {
			if (!model) return localSummarizer.summarize({ entries, shadowed, systemPrompt, tools, capChars });
			const messages = convertToLlm(buildSummarizationInput(entries, shadowed).messages);
			const stream = STREAM_FN(model, { systemPrompt, messages, tools: tools as never }, { maxTokens: 8192 });
			const parts: string[] = [];
			for await (const event of stream) {
				if (event.type === "text_delta") parts.push(event.delta);
			}
			const raw = parts.join("").trim();
			if (!raw) return localSummarizer.summarize({ entries, shadowed, systemPrompt, tools, capChars });
			return raw.length > capChars ? `${raw.slice(0, capChars)}\n…` : raw;
		},
	};
}
