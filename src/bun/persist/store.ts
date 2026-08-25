/**
 * The persistence layer: a per-root session log backed by pi's JSONL session
 * repo (append-only, torn-write repaired on load). Everything that writes or
 * reads the log lives here; the agent loop and compaction consume the
 * SessionScope / SessionStore contracts and never touch the log format.
 *
 * - Single continuous session per root: open the newest session in the repo, create one if none exists; keep appending to the same session
 * - Full ingestion: user / assistant (thinking, tool_use blocks verbatim) as pi messages; the event
 *   vocabulary (turn/step markers, tool calls/results, request headers, compaction, escalations)
 *   as custom entries — see persist/events.ts
 * - One store, many roots: reads take the root dir explicitly; appends go through a per-root
 *   SessionScope (each partner's agent owns one, so concurrent runs append to their own logs)
 * - Restore: buildSessionContext + entryProjectors reconstruct the AgentMessage chain
 *   (pi's JSONL backend has built-in append-only writes and torn-write repair)
 */
import { cp } from "node:fs/promises";
import type { AgentMessage, CustomEntry, Entry } from "@earendil-works/pi-agent-core";
import { buildSessionContext, JsonlSessionRepo, Session } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import type { EscalationStatus, RequestTool, SandboxMode } from "../../shared/rpc";
import type { Surface, SurfaceOpRecord } from "../../shared/surface";
import { buildResumeTurn, deriveMessages as deriveSurfaceMessages, dropDanglingTurn, foldSurface, pairToolResults } from "../core/surface";
import { createExecutionEnv } from "../tools/execution-env";
import { EVENTS, type ToolResultEventData, type TurnEndReason } from "./events";

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
	kind: "user" | "send_message" | "escalation" | "error";
	text: string;
	time: number;
	/** Escalation payload (kind "escalation" only): the approval request + current status. */
	escalation?: {
		id: string;
		command: string;
		from: SandboxMode;
		to: SandboxMode;
		justification: string;
		status: EscalationStatus;
	};
}

/**
 * The write path: appends bound to one session root — each partner's agent
 * writes through its own scope. Every method resolves only after the entry is
 * on disk, so an awaited append is a durability barrier (checkpoint); the
 * agent loop awaits them at the exact boundaries that need it (see agent.ts).
 */
export interface SessionScope {
	appendUser(content: string, timestamp: number): Promise<void>;
	/** The turn's assistant message; trailing tool results (batching callers) become tool/result events. */
	appendAssistant(meta: AssistantMeta, timestamp: number): Promise<void>;
	appendSendMessage(content: string, details: Record<string, unknown>, timestamp: number): Promise<void>;
	/** Persist the current system prompt (custom entry; the trajectory view shows it). */
	appendSystemPrompt(text: string, timestamp: number): Promise<void>;
	/** Persist a system reminder (custom entry; part of the trajectory timeline). */
	appendReminder(text: string, timestamp: number): Promise<void>;
	/** Mark the preceding user message as a follow-up (queued mid-run; log-only). */
	appendFollowUp(timestamp: number): Promise<void>;
	/** Persist a request header (system prompt + resolved tool definitions) so every model request is reconstructable (invariant 1). */
	appendRequestHeader(systemPrompt: string, tools: RequestTool[], timestamp: number): Promise<void>;
	/** A run began (agent_start): the log gets a turn/start marker. */
	appendTurnStart(turn: number, timestamp: number): Promise<void>;
	/** A run settled (agent_end): the log gets a turn/end marker with the reason (and the error on failure). */
	appendTurnEnd(turn: number, reason: TurnEndReason, timestamp: number, error?: string): Promise<void>;
	/** A step began (pi turn_start): the log gets a step/start marker. */
	appendStepStart(turn: number, step: number, timestamp: number): Promise<void>;
	/** A step settled (pi turn_end): the log gets a step/end marker. */
	appendStepEnd(turn: number, step: number, timestamp: number): Promise<void>;
	/** A tool call was requested (tool_execution_start): the log gets the call before the tool runs. */
	appendToolCall(callId: string, name: string, args: unknown, turn: number, step: number, timestamp: number): Promise<void>;
	/** A tool result landed (tool_execution_end; also the restart-resume path). Becomes a surface node. */
	appendToolResult(result: ToolResultMessage, timestamp: number): Promise<void>;
	/** Persist a sandbox-escalation lifecycle record (escalation/request | escalation/decision; log-only). */
	appendEscalationRecord(type: "escalation/request" | "escalation/decision", details: Record<string, unknown>, timestamp: number): Promise<void>;
	/** Record a surface replace (compaction checkpoint) as an append-only `surface_op` log entry. */
	appendSurfaceOp(op: SurfaceOpRecord, timestamp: number): Promise<void>;
	/** Persist a compaction summary (custom entry; becomes the replacement checkpoint node). Returns its pi entry id. */
	appendCompactionSummary(text: string, timestamp: number): Promise<string>;
	/** Persist a compaction transaction marker (compaction/start | compaction/end; log-only). */
	appendCompactionRecord(type: "compaction/start" | "compaction/end", details: Record<string, unknown>, timestamp: number): Promise<void>;
}

export interface SessionStore {
	/** Appends bound to `dir` (the store caches open roots; nothing opens until first use). */
	scope(dir: string): SessionScope;
	/** Records visible to the frontend (user + send_message), in session order. */
	visibleHistory(dir: string): Promise<VisibleItem[]>;
	/** The last visible message (user or send_message), or null for an empty session. */
	lastMessage(dir: string): Promise<VisibleItem | null>;
	/** The full conversation chain (for agent context restore). */
	restoreMessages(dir: string): Promise<AgentMessage[]>;
	/** Fold the session log into the model-visible surface. */
	surface(dir: string): Promise<Surface>;
	/** Project the surface into the pi message chain the model sees. */
	deriveMessages(dir: string): Promise<AgentMessage[]>;
	/** The persisted escalation request by id (restart-resume: command, granted mode, blocked tool call), or null. */
	escalationRequest(
		dir: string,
		id: string,
	): Promise<{
		command: string;
		from: SandboxMode;
		to: SandboxMode;
		justification: string;
		toolCallId: string;
		timestamp: number;
	} | null>;
	/** The blocked assistant turn for a resume: the messages and where the tool result must be inserted. Null when unresumable. */
	resumeTurn(dir: string, toolCallId: string): Promise<{ messages: AgentMessage[]; insertAt: number } | null>;
	/** Fork the log into a new root (raw JSONL copy); the surface re-folds there (fork/restore). */
	forkTo(sourceDir: string, targetDir: string): Promise<void>;
	/** Drop a cached root state (partner deletion: a recreated same-name partner must start empty, not replay the old in-memory session). */
	evictRoot(dir: string): void;
	/** Raw pi entries (for trajectory folding; thinking/tool content still never enters visibleHistory). */
	rawEntries(dir: string): Promise<Entry[]>;
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

/** Project a persisted tool/result event back into the toolResult message the model chain expects. */
const TOOL_RESULT_PROJECTOR = (entry: CustomEntry): AgentMessage[] | undefined => {
	const data = entry.data as Partial<ToolResultEventData> | undefined;
	if (!data || typeof data.toolCallId !== "string") return undefined;
	return [
		{
			role: "toolResult",
			toolCallId: data.toolCallId,
			toolName: typeof data.toolName === "string" ? data.toolName : "",
			content: Array.isArray(data.content) ? data.content : [],
			details: data.details,
			usage: data.usage as ToolResultMessage["usage"] | undefined,
			isError: data.isError === true,
			timestamp: (entry.data as { timestamp?: unknown }).timestamp ?? entry.timestamp ?? 0,
		} as ToolResultMessage,
	];
};

/** One open session repo per root directory (sessions isolated per Partner). */
interface RootState {
	repo: JsonlSessionRepo;
	session: Session;
	entries: Entry[];
}

export function createSessionStore(): SessionStore {
	// pi's JSONL backend needs a FileSystem adapter; reuse the execution environment directly (pure fs part)
	// Promise-valued: first opens race (mount-time history + set_partner can both touch a fresh root) —
	// sharing the in-flight open keeps concurrent callers on one session instead of creating a second file.
	const roots = new Map<string, Promise<RootState>>();

	function openRoot(newRoot: string): Promise<RootState> {
		const cached = roots.get(newRoot);
		if (cached) return cached;
		const opening = openRootUncached(newRoot).catch((error) => {
			// A failed open must not poison the cache for later retries
			if (roots.get(newRoot) === opening) roots.delete(newRoot);
			throw error;
		});
		roots.set(newRoot, opening);
		return opening;
	}

	async function openRootUncached(newRoot: string): Promise<RootState> {
		const repo = new JsonlSessionRepo({ fs: createExecutionEnv(newRoot), sessionsRoot: newRoot });
		const sessions = await repo.list();
		// Single continuous session: take the newest
		const session = sessions.length > 0 ? await repo.open(sessions[sessions.length - 1]) : await repo.create({ cwd: newRoot });
		const state: RootState = { repo, session, entries: [] };
		roots.set(newRoot, Promise.resolve(state));
		await refreshEntries(state);
		return state;
	}

	function stateFor(dir: string): Promise<RootState> {
		return openRoot(dir);
	}

	async function refreshEntries(state: RootState) {
		const leafId = await state.session.getLeafId();
		// findEntriesOnBranch returns leaves first; reverse so the root comes first (session order)
		const walked = leafId ? await state.session.findEntriesOnBranch({ start: leafId }) : [];
		state.entries = walked.reverse();
	}

	async function appendMessage(dir: string, message: AgentMessage) {
		const state = await stateFor(dir);
		await state.session.appendMessage(message);
		await refreshEntries(state);
	}

	async function appendCustom(dir: string, customType: string, data: Record<string, unknown>) {
		const state = await stateFor(dir);
		await state.session.appendCustomEntry(customType, data);
		await refreshEntries(state);
	}

	/** A tool result persisted as a tool/result event (surface node; see core/surface.ts). */
	function toolResultEventData(result: ToolResultMessage): ToolResultEventData {
		return stripUndefined({
			toolCallId: result.toolCallId,
			toolName: result.toolName,
			content: result.content,
			details: result.details,
			usage: result.usage,
			isError: result.isError === true,
		}) as ToolResultEventData;
	}

	function scope(dir: string): SessionScope {
		return {
			async appendUser(content, timestamp) {
				await appendMessage(dir, { role: "user", content, timestamp });
			},
			async appendAssistant(meta, timestamp) {
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
				await appendMessage(dir, assistant);
				// Batching callers (tests) hand results with the turn; the live loop writes them at
				// tool_execution_end instead. Either way they land as tool/result events.
				for (const result of meta.toolResults ?? []) {
					await appendCustom(dir, EVENTS.toolResult, { ...toolResultEventData(result), timestamp });
				}
			},
			async appendSendMessage(content, details, timestamp) {
				await appendCustom(dir, EVENTS.sendMessage, { text: content, timestamp, ...details });
			},
			async appendSystemPrompt(text, timestamp) {
				await appendCustom(dir, EVENTS.systemPrompt, { text, timestamp });
			},
			async appendReminder(text, timestamp) {
				await appendCustom(dir, EVENTS.systemReminder, { text, timestamp });
			},
			async appendFollowUp(timestamp) {
				await appendCustom(dir, EVENTS.followUp, { timestamp });
			},
			async appendRequestHeader(systemPrompt, tools, timestamp) {
				// Tool descriptors may carry undefined label/description/parameters — pi's
				// assertJsonSerializable rejects undefined values, so strip them like appendAssistant does.
				await appendCustom(dir, EVENTS.requestHeader, stripUndefined({ systemPrompt, toolNames: tools.map((t) => t.name), tools, timestamp }) as Record<string, unknown>);
			},
			async appendTurnStart(turn, timestamp) {
				await appendCustom(dir, EVENTS.turnStart, { turn, timestamp });
			},
			async appendTurnEnd(turn, reason, timestamp, error) {
				await appendCustom(dir, EVENTS.turnEnd, { turn, reason, timestamp, ...(error !== undefined ? { error } : {}) });
			},
			async appendStepStart(turn, step, timestamp) {
				await appendCustom(dir, EVENTS.stepStart, { turn, step, timestamp });
			},
			async appendStepEnd(turn, step, timestamp) {
				await appendCustom(dir, EVENTS.stepEnd, { turn, step, timestamp });
			},
			async appendToolCall(callId, name, args, turn, step, timestamp) {
				await appendCustom(dir, EVENTS.toolCall, { callId, name, args, turn, step, timestamp });
			},
			async appendToolResult(result, timestamp) {
				await appendCustom(dir, EVENTS.toolResult, { ...toolResultEventData(result), timestamp });
			},
			async appendEscalationRecord(type, details, timestamp) {
				await appendCustom(dir, type, { ...details, timestamp });
			},
			async appendSurfaceOp(op, timestamp) {
				await appendCustom(dir, EVENTS.surfaceOp, { ...op, timestamp });
			},
			async appendCompactionSummary(text, timestamp) {
				await appendCustom(dir, EVENTS.compactionSummary, { text, timestamp });
				const state = await stateFor(dir);
				const entry = state.entries.filter((e) => e.type === "custom" && e.customType === EVENTS.compactionSummary).at(-1);
				if (!entry) throw new Error("compaction_summary append failed");
				return entry.id;
			},
			async appendCompactionRecord(type, details, timestamp) {
				await appendCustom(dir, type, { ...details, timestamp });
			},
		};
	}

	return {
		scope,
		async visibleHistory(dir) {
			const state = await stateFor(dir);
			// Escalation decisions by escalation id (a decision may follow its request later in the log)
			const decisions = new Map<string, { approved: boolean; reason?: string }>();
			for (const entry of state.entries) {
				if (entry.type !== "custom" || entry.customType !== EVENTS.escalationDecision) continue;
				const data = entry.data as { escalationId?: unknown; approved?: unknown } | undefined;
				if (data?.escalationId == null) continue;
				decisions.set(String(data.escalationId), { approved: data.approved === true });
			}
			return state.entries.flatMap((entry): VisibleItem[] => {
				if (entry.type === "message" && entry.message.role === "user") {
					const content = entry.message.content;
					return [{ id: entry.id, kind: "user", text: typeof content === "string" ? content : "", time: entry.message.timestamp ?? 0 }];
				}
				if (entry.type === "custom" && entry.customType === EVENTS.sendMessage) {
					const data = entry.data as { text: string; timestamp: number } | undefined;
					if (!data) return [];
					return [{ id: entry.id, kind: "send_message", text: data.text, time: data.timestamp }];
				}
				if (entry.type === "custom" && entry.customType === EVENTS.turnEnd) {
					// A failed run renders its persisted error (reason "error" carries the message)
					const data = entry.data as { reason?: unknown; error?: unknown; timestamp?: unknown } | undefined;
					if (data?.reason !== "error" || typeof data.error !== "string") return [];
					return [{ id: entry.id, kind: "error", text: data.error, time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0) }];
				}
				if (entry.type === "custom" && entry.customType === EVENTS.escalationRequest) {
					const data = entry.data as { escalationId?: unknown; command?: unknown; from?: unknown; to?: unknown; justification?: unknown; timestamp?: unknown } | undefined;
					if (data?.escalationId == null) return [];
					const decision = decisions.get(String(data.escalationId));
					return [
						{
							id: entry.id,
							kind: "escalation",
							text: String(data.command ?? ""),
							time: typeof data.timestamp === "number" ? data.timestamp : 0,
							escalation: {
								id: String(data.escalationId),
								command: String(data.command ?? ""),
								from: data.from as SandboxMode,
								to: data.to as SandboxMode,
								justification: String(data.justification ?? ""),
								status: decision ? (decision.approved ? "approved" : "rejected") : "pending",
							},
						},
					];
				}
				return [];
			});
		},
		async lastMessage(dir) {
			const state = await stateFor(dir);
			// Entries are in session order; take the last visible one without materializing the whole history
			let last: VisibleItem | null = null;
			for (const entry of state.entries) {
				if (entry.type === "message" && entry.message.role === "user") {
					const content = entry.message.content;
					last = { id: entry.id, kind: "user", text: typeof content === "string" ? content : "", time: entry.message.timestamp ?? 0 };
				} else if (entry.type === "custom" && entry.customType === EVENTS.sendMessage) {
					const data = entry.data as { text: string; timestamp: number } | undefined;
					if (!data) continue;
					last = { id: entry.id, kind: "send_message", text: data.text, time: data.timestamp };
				}
			}
			return last;
		},
		async restoreMessages(dir) {
			const state = await stateFor(dir);
			const context = buildSessionContext(state.entries, {
				entryProjectors: {
					[EVENTS.sendMessage]: SEND_MESSAGE_PROJECTOR,
					[EVENTS.toolResult]: TOOL_RESULT_PROJECTOR,
				},
			});
			// The log records arrival order — a user message persisted mid-tool lands before the
			// tool/result — so pair tool results back to their assistant before exposing the chain.
			return dropDanglingTurn(pairToolResults(context.messages));
		},
		async surface(dir) {
			const state = await stateFor(dir);
			return foldSurface(state.entries);
		},
		async deriveMessages(dir) {
			const state = await stateFor(dir);
			return deriveSurfaceMessages(state.entries, foldSurface(state.entries));
		},
		async escalationRequest(dir, id) {
			const state = await stateFor(dir);
			for (const entry of state.entries) {
				if (entry.type !== "custom" || entry.customType !== EVENTS.escalationRequest) continue;
				const data = entry.data as
					| { escalationId?: unknown; command?: unknown; from?: unknown; to?: unknown; justification?: unknown; toolCallId?: unknown; timestamp?: unknown }
					| undefined;
				if (data?.escalationId !== id) continue;
				return {
					command: String(data.command ?? ""),
					from: data.from as SandboxMode,
					to: data.to as SandboxMode,
					justification: String(data.justification ?? ""),
					toolCallId: String(data.toolCallId ?? ""),
					timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
				};
			}
			return null;
		},
		async resumeTurn(dir, toolCallId) {
			// The blocked turn is always in the log: the assistant message lands at message_end,
			// before any tool runs — a blocked-and-interrupted run still has its turn persisted
			// (only the tool result is missing). Superseded runs (something followed the turn)
			// resolve to null — the escalation is orphaned, not resumable.
			const state = await stateFor(dir);
			return buildResumeTurn(state.entries, toolCallId);
		},
		async forkTo(sourceDir, targetDir) {
			// Load the source first (validates it is a readable session root), then copy the whole log
			// tree (pi nests session files under a cwd-derived directory) and re-open the target so its
			// surface re-folds deterministically (fork/restore: log prefix boundary = the copied log).
			await openRoot(sourceDir);
			await cp(sourceDir, targetDir, { recursive: true, force: true, filter: (src) => !src.endsWith(".tmp") });
			await openRoot(targetDir);
		},
		evictRoot(dir) {
			roots.delete(dir);
		},
		async rawEntries(dir) {
			const state = await stateFor(dir);
			return state.entries;
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
