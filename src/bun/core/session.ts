/**
 * Conversation persistence: based on pi's JSONL session layer (JsonlSessionRepo + Session).
 *
 * - Single continuous session: open the newest session in the repo, create one if none exists; keep appending to the same session
 * - Full ingestion: user / assistant (thinking, tool_use blocks verbatim) / toolResult /
 *   send_message custom entries; the frontend only sees user and send_message
 * - Restore: buildSessionContext + entryProjectors reconstruct the AgentMessage chain
 *   (pi's JSONL backend has built-in append-only writes and torn-write repair)
 */
import type { AgentMessage, CustomEntry, Entry } from "@earendil-works/pi-agent-core";
import { buildSessionContext, JsonlSessionRepo, Session } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { createExecutionEnv } from "../tools/execution-env";
import { DATABASE_ROOT, PROJECT_ROOT } from "./config";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * send_message visible messages: enter the agent context as custom messages,
 * projected by convertToLlm into visible text; display:false ones are dropped.
 */
declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		sendMessage: {
			role: "custom";
			customType: "send_message";
			content: string;
			display: boolean;
			timestamp: number;
		};
	}
}

export interface AssistantMeta {
	blocks: AssistantMessage["content"];
	toolResults?: ToolResultMessage[];
	usage?: Usage;
}

export interface VisibleItem {
	/** pi entry id; the view dedupes incremental renders by it. */
	id: string;
	kind: "user" | "send_message";
	text: string;
	time: number;
}

export interface SessionStore {
	/** Open/restore complete (can be awaited before the first operation). */
	ready(): Promise<void>;
	/** Switch the session root (isolated per Partner): rebuild repo/session and replay the new root's history. */
	setRoot(root: string): Promise<void>;
	appendUser(content: string, timestamp: number): Promise<void>;
	appendAssistant(meta: AssistantMeta, timestamp: number): Promise<void>;
	appendSendMessage(content: string, details: Record<string, unknown>, timestamp: number): Promise<void>;
	/** Persist the current system prompt (custom entry; the trajectory view shows it). */
	appendSystemPrompt(text: string, timestamp: number): Promise<void>;
	/** Persist a system reminder (custom entry; part of the trajectory timeline). */
	appendReminder(text: string, timestamp: number): Promise<void>;
	/** Records visible to the frontend (user + send_message), in session order. */
	visibleHistory(): VisibleItem[];
	/** The full conversation chain (for agent context restore). */
	restoreMessages(): Promise<AgentMessage[]>;
	/** Raw pi entries (for trajectory folding; thinking/tool content still never enters visibleHistory). */
	rawEntries(): Entry[];
}

const SEND_MESSAGE_PROJECTOR = (entry: CustomEntry): AgentMessage[] | undefined => {
	const data = entry.data as { text: string; timestamp: number } | undefined;
	if (!data) return undefined;
	return [
		{
			role: "custom",
			customType: "send_message",
			content: data.text,
			display: true,
			timestamp: data.timestamp,
		},
	];
};

export function createSessionStore(root: string = DATABASE_ROOT): SessionStore {
	// pi's JSONL backend needs a FileSystem adapter; reuse the execution environment directly (pure fs part)
	let currentRoot = root;
	let repo: JsonlSessionRepo;
	let session: Session | null = null;
	let entries: Entry[] = [];
	let opened = false;

	async function openRoot(newRoot: string) {
		currentRoot = newRoot;
		// One repo per root directory (session files isolated per Partner)
		repo = new JsonlSessionRepo({ fs: createExecutionEnv(currentRoot), sessionsRoot: currentRoot });
		session = null;
		entries = [];
		const sessions = await repo.list();
		if (sessions.length > 0) {
			// Single continuous session: take the newest
			session = await repo.open(sessions[sessions.length - 1]);
		} else {
			session = await repo.create({ cwd: PROJECT_ROOT });
		}
		await refreshEntries();
	}

	async function ensureOpen() {
		if (opened) return;
		await openRoot(currentRoot);
		opened = true;
	}

	async function refreshEntries() {
		const leafId = await session!.getLeafId();
		// findEntriesOnBranch returns leaves first; reverse so the root comes first (session order)
		const walked = leafId ? await session!.findEntriesOnBranch({ start: leafId }) : [];
		entries = walked.reverse();
	}

	async function appendMessage(message: AgentMessage) {
		await ensureOpen();
		await session!.appendMessage(message);
		await refreshEntries();
	}

	return {
		async ready() {
			await ensureOpen();
		},
		async setRoot(newRoot: string) {
			await openRoot(newRoot);
		},
		async appendUser(content, timestamp) {
			await appendMessage({ role: "user", content, timestamp });
		},
		async appendAssistant(meta, timestamp) {
			await ensureOpen();
			// Messages built by the pi loop may carry undefined fields (e.g. toolResult.details/usage),
			// which assertJsonSerializable would reject → recursively strip them before appending
			const assistant: AssistantMessage = {
				role: "assistant",
				content: stripUndefined(meta.blocks) as AssistantMessage["content"],
				timestamp,
				api: "",
				provider: "",
				model: "",
				usage: meta.usage ?? EMPTY_USAGE,
				stopReason: "stop",
			};
			await session!.appendMessage(assistant);
			for (const result of meta.toolResults ?? []) {
				await session!.appendMessage(stripUndefined(result) as ToolResultMessage);
			}
			await refreshEntries();
		},
		async appendSendMessage(content, details, timestamp) {
			await ensureOpen();
			await session!.appendCustomEntry("send_message", { text: content, timestamp, ...details });
			await refreshEntries();
		},
		async appendSystemPrompt(text, timestamp) {
			await ensureOpen();
			await session!.appendCustomEntry("system_prompt", { text, timestamp });
			await refreshEntries();
		},
		async appendReminder(text, timestamp) {
			await ensureOpen();
			await session!.appendCustomEntry("system_reminder", { text, timestamp });
			await refreshEntries();
		},
		visibleHistory(): VisibleItem[] {
			return entries.flatMap((entry): VisibleItem[] => {
				if (entry.type === "message" && entry.message.role === "user") {
					const content = entry.message.content;
					return [{ id: entry.id, kind: "user", text: typeof content === "string" ? content : "", time: entry.message.timestamp ?? 0 }];
				}
				if (entry.type === "custom" && entry.customType === "send_message") {
					const data = entry.data as { text: string; timestamp: number } | undefined;
					if (!data) return [];
					return [{ id: entry.id, kind: "send_message", text: data.text, time: data.timestamp }];
				}
				return [];
			});
		},
		async restoreMessages(): Promise<AgentMessage[]> {
			await ensureOpen();
			const context = buildSessionContext(entries, {
				entryProjectors: { send_message: SEND_MESSAGE_PROJECTOR },
			});
			return dropDanglingTurn(context.messages);
		},
		rawEntries() {
			return entries;
		},
	};
}

/** Recursively strip undefined (pi's assertJsonSerializable rejects undefined values). */
function stripUndefined(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripUndefined);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			if (child !== undefined) out[key] = stripUndefined(child);
		}
		return out;
	}
	return value;
}

/**
 * Guard for an unfinished final turn: the last assistant contains toolCall blocks but lacks the
 * matching toolResult (restart-interruption scenario) → drop that turn.
 */
function dropDanglingTurn(messages: AgentMessage[]): AgentMessage[] {
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
