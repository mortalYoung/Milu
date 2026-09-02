/**
 * Slice folding — Origin (the JSONL log) → Slice (the model-visible projection).
 *
 * Concept naming (see docs/2026-09-02-origin-slice-view-naming.md): Origin is the immutable
 * log; Slice is the set of Origin entries the model sees (surface.nodes). This module folds the
 * Origin and applies logged `surface_op` records (slice rewrites: compaction checkpoints and
 * tool-result pruning). The derived prompt chain (deriveMessages) is a further projection of
 * the Slice — it is not the Slice itself.
 */
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { RequestTool } from "../../shared/rpc";
import { applyReplace, foldSurface, isSurfaceEntry, SurfaceError } from "../../shared/slice";
import type { Surface } from "../../shared/surface";

export { applyReplace, foldSurface, isSurfaceEntry, SurfaceError };

import { type ContextChangedEventData, EVENTS } from "../persist/events";

export function deriveMessages(entries: Entry[], surface: Surface): AgentMessage[] {
	return dropDanglingTurn(projectChain(entries, surface));
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function contextChangedText(data: ContextChangedEventData): string {
	const lines = [`Current workspace: ${data.workspace ?? "unset"}.`, `Current storage: ${data.storage ?? "unset"}.`, `Current sandbox mode: ${data.sandbox}.`];
	if (data.skills.length > 0) {
		lines.push(
			"",
			"<available_skills>",
			...data.skills.map((s) => `- ${escapeXml(s.name)}: ${escapeXml(s.description)}`),
			"</available_skills>",
			"",
			"When a task matches a skill above, call the skill tool with its exact name to load the full instructions. The latest <available_skills> message is authoritative.",
		);
	}
	return `<system_reminder>${lines.join("\n")}</system_reminder>`;
}

export function deriveEventMessage(entry: Entry): AgentMessage | null {
	if (entry.type === "message") {
		return entry.message as unknown as AgentMessage;
	}
	if (entry.type === "custom" && entry.customType === EVENTS.sendMessage) {
		const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
		return {
			role: "custom",
			customType: "send_message",
			content: typeof data.text === "string" ? data.text : "",
			display: true,
			timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		} as AgentMessage;
	}
	if (entry.type === "custom" && entry.customType === EVENTS.toolResult) {
		const data = (entry.data ?? {}) as {
			toolCallId?: unknown;
			toolName?: unknown;
			content?: unknown;
			details?: unknown;
			usage?: unknown;
			addedToolNames?: unknown;
			isError?: unknown;
			timestamp?: unknown;
		};
		return {
			role: "toolResult",
			toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : "",
			toolName: typeof data.toolName === "string" ? data.toolName : "",
			content: Array.isArray(data.content) ? data.content : [],
			details: data.details,
			usage: data.usage as ToolResultMessage["usage"] | undefined,
			...(Array.isArray(data.addedToolNames) ? { addedToolNames: data.addedToolNames } : {}),
			isError: data.isError === true,
			timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		} as unknown as AgentMessage;
	}
	if (entry.type === "custom" && entry.customType === EVENTS.compactionSummary) {
		const data = (entry.data ?? {}) as { text?: unknown; timestamp?: unknown };
		return {
			role: "user",
			content: typeof data.text === "string" ? data.text : "",
			timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		} as AgentMessage;
	}
	if (entry.type === "custom" && entry.customType === EVENTS.contextChanged) {
		const data = (entry.data ?? {}) as Partial<ContextChangedEventData> & { timestamp?: unknown };
		return {
			role: "user",
			content: contextChangedText({
				workspace: typeof data.workspace === "string" ? data.workspace : null,
				storage: typeof data.storage === "string" ? data.storage : null,
				sandbox: data.sandbox ?? "workspace-write",
				skills: Array.isArray(data.skills) ? data.skills : [],
			}),
			timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		} as AgentMessage;
	}
	return null;
}

export function projectChain(entries: Entry[], surface?: Surface): AgentMessage[] {
	const byId = new Map<string, Entry>();
	for (const e of entries) byId.set(e.id, e);
	const out: AgentMessage[] = [];
	const nodes = (surface ?? foldSurface(entries)).nodes;
	for (const node of nodes) {
		const entry = byId.get(node.id);
		if (!entry) continue;
		const msg = deriveEventMessage(entry);
		if (msg) out.push(msg);
	}
	return pairToolResults(out);
}

export function pairToolResults(messages: AgentMessage[]): AgentMessage[] {
	const out: AgentMessage[] = [];
	for (const m of messages) {
		if (m.role !== "toolResult") {
			out.push(m);
			continue;
		}
		let owner = -1;
		for (let i = out.length - 1; i >= 0; i--) {
			const prev = out[i];
			if (prev.role !== "assistant") continue;
			const blocks = Array.isArray(prev.content) ? prev.content : [];
			const ids = blocks.filter((b) => b.type === "toolCall").map((b) => (b as { id: string }).id);
			if (ids.includes((m as ToolResultMessage).toolCallId)) {
				owner = i;
				break;
			}
		}
		if (owner < 0) {
			out.push(m);
			continue;
		}
		let k = owner;
		while (k + 1 < out.length && out[k + 1].role === "toolResult") k++;
		out.splice(k + 1, 0, m);
	}
	return out;
}

export function buildResumeTurn(entries: Entry[], toolCallId: string): { messages: AgentMessage[]; insertAt: number } | null {
	const messages = projectChain(entries);
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const blocks = m.content as { type: string; id: string }[];
		if (!blocks.some((b) => b.type === "toolCall" && b.id === toolCallId)) continue;
		if (messages.slice(i + 1).some((m2) => m2.role === "assistant" || m2.role === "toolResult")) return null;
		return { messages, insertAt: i + 1 };
	}
	return null;
}

export function dropDanglingTurn(messages: AgentMessage[]): AgentMessage[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		const blocks = m.content as { type: string; id: string }[];
		const hasToolCalls = blocks.some((b) => b.type === "toolCall");
		if (!hasToolCalls) break;
		const next = messages[i + 1];
		const complete = next != null && next.role === "toolResult" && (next as ToolResultMessage).toolCallId === blocks.find((b) => b.type === "toolCall")?.id;
		if (complete) break;
		messages.splice(i);
		break;
	}
	return messages;
}

export function reconstructRequestHeader(entries: Entry[]): { systemPrompt: string; tools: RequestTool[]; toolNames: string[]; time: number } | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== EVENTS.requestHeader) continue;
		const data = (entry.data ?? {}) as { systemPrompt?: unknown; tools?: unknown; toolNames?: unknown; timestamp?: unknown };
		const tools = Array.isArray(data.tools) ? data.tools.filter((t): t is RequestTool => !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string") : [];
		const toolNames = tools.length > 0 ? tools.map((t) => t.name) : Array.isArray(data.toolNames) ? data.toolNames.filter((n): n is string => typeof n === "string") : [];
		return {
			systemPrompt: typeof data.systemPrompt === "string" ? data.systemPrompt : "",
			tools,
			toolNames,
			time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		};
	}
	return null;
}
