import { cp } from "node:fs/promises";
import type { AgentMessage, CustomEntry, Entry } from "@earendil-works/pi-agent-core";
import { buildSessionContext, JsonlSessionRepo, Session } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type ToolResultMessage, type Usage, uuidv7 } from "@earendil-works/pi-ai";
import type { RequestTool, SandboxMode, ThinkingLevel, ViewItem } from "../../shared/rpc";

export type { ViewItem } from "../../shared/rpc";

import type { Surface, SurfaceOpRecord } from "../../shared/surface";
import { buildResumeTurn, contextChangedText, deriveMessages as deriveSurfaceMessages, dropDanglingTurn, foldSurface, pairToolResults } from "../core/surface";
import { createExecutionEnv } from "../tools/execution-env";
import { projectVisibleHistory } from "./entry-meta";
import {
	type CommandDoneEventData,
	type CommandRunEventData,
	type ContextChangedEventData,
	EVENTS,
	type RetryScheduledEventData,
	type RetryStartedEventData,
	type ShellDoneEventData,
	type ShellRunEventData,
	type SkillDoneEventData,
	type SkillRunEventData,
	type ToolResultEventData,
	type TurnEndReason,
} from "./events";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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

export interface AssistantTiming {
	stepStartTime: number;
	firstTokenTime: number | null;
	completedTime: number;
}

export interface AssistantMeta {
	blocks: AssistantMessage["content"];
	toolResults?: ToolResultMessage[];
	usage?: Usage;
	timing?: AssistantTiming;
	api?: string;
	provider?: string;
	model?: string;
	responseModel?: string;
	responseId?: string;
	stopReason?: AssistantMessage["stopReason"];
}

export interface SessionScope {
	appendUser(content: string, timestamp: number, meta?: { skill?: string }): Promise<void>;
	appendAssistant(meta: AssistantMeta, timestamp: number): Promise<void>;
	appendSendMessage(content: string, details: Record<string, unknown>, timestamp: number): Promise<void>;
	appendSystemPrompt(text: string, timestamp: number): Promise<void>;
	appendFollowUp(timestamp: number): Promise<void>;
	appendRequestHeader(systemPrompt: string, tools: RequestTool[], timestamp: number): Promise<void>;
	appendTurnStart(turn: number, timestamp: number): Promise<void>;
	appendTurnEnd(turn: number, reason: TurnEndReason, timestamp: number, error?: string): Promise<void>;
	appendStepStart(turn: number, step: number, timestamp: number): Promise<void>;
	appendStepEnd(turn: number, step: number, timestamp: number): Promise<void>;
	appendToolCall(callId: string, name: string, args: unknown, turn: number, step: number, timestamp: number): Promise<void>;
	appendToolResult(result: ToolResultMessage, timestamp: number): Promise<string>;
	appendEscalationRecord(type: "escalation/request" | "escalation/decision", details: Record<string, unknown>, timestamp: number): Promise<void>;
	appendCommandRun(details: CommandRunEventData, timestamp: number): Promise<void>;
	appendCommandDone(details: CommandDoneEventData, timestamp: number): Promise<void>;
	appendContextChanged(details: ContextChangedEventData, timestamp: number): Promise<void>;
	lastContextChanged(): Promise<{ data: ContextChangedEventData; timestamp: number } | null>;
	appendSkillRun(details: SkillRunEventData, timestamp: number): Promise<void>;
	appendSkillDone(details: SkillDoneEventData, timestamp: number): Promise<void>;
	appendShellRun(details: ShellRunEventData, timestamp: number): Promise<void>;
	appendShellDone(details: ShellDoneEventData, timestamp: number): Promise<void>;
	appendRetryScheduled(details: RetryScheduledEventData, timestamp: number): Promise<void>;
	appendRetryStarted(details: RetryStartedEventData, timestamp: number): Promise<void>;
	appendSurfaceOp(op: SurfaceOpRecord, timestamp: number): Promise<void>;
	appendCompactionSummary(text: string, timestamp: number): Promise<string>;
	appendCompactionRecord(type: "compaction/start" | "compaction/end" | "compaction/prune", details: Record<string, unknown>, timestamp: number): Promise<void>;
	appendModelChange(model: { provider: string; modelId?: string }, timestamp: number): Promise<void>;
	appendThinkingLevelChange(level: ThinkingLevel, timestamp: number): Promise<void>;
}

export interface SessionStore {
	scope(dir: string): SessionScope;
	/** Project the Origin (raw log) into the user View (chat transcript rows). */
	visibleHistory(dir: string): Promise<ViewItem[]>;
	lastMessage(dir: string): Promise<ViewItem | null>;
	restoreMessages(dir: string): Promise<AgentMessage[]>;
	surface(dir: string): Promise<Surface>;
	deriveMessages(dir: string): Promise<AgentMessage[]>;
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
	resumeTurn(dir: string, toolCallId: string): Promise<{ messages: AgentMessage[]; insertAt: number } | null>;
	forkTo(sourceDir: string, targetDir: string): Promise<void>;
	evictRoot(dir: string): void;
	rawEntries(dir: string): Promise<Entry[]>;
	/** Start a fresh session file for the root, archiving the current one as its parent. Returns the new session id. */
	rotateSession(dir: string): Promise<string>;
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

const CONTEXT_CHANGED_PROJECTOR = (entry: CustomEntry): AgentMessage[] | undefined => {
	const data = entry.data as (Partial<ContextChangedEventData> & { timestamp?: unknown }) | undefined;
	if (!data) return undefined;
	return [
		{
			role: "user",
			content: contextChangedText({
				workspace: typeof data.workspace === "string" ? data.workspace : null,
				storage: typeof data.storage === "string" ? data.storage : null,
				sandbox: data.sandbox ?? "workspace-write",
				skills: Array.isArray(data.skills) ? data.skills : [],
			}),
			timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
		},
	];
};

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

interface RootState {
	repo: JsonlSessionRepo;
	session: Session;
	entries: Entry[];
}

export function createSessionStore(): SessionStore {
	const roots = new Map<string, Promise<RootState>>();

	function openRoot(newRoot: string): Promise<RootState> {
		const cached = roots.get(newRoot);
		if (cached) return cached;
		const opening = openRootUncached(newRoot).catch((error) => {
			if (roots.get(newRoot) === opening) roots.delete(newRoot);
			throw error;
		});
		roots.set(newRoot, opening);
		return opening;
	}

	async function openRootUncached(newRoot: string): Promise<RootState> {
		const repo = new JsonlSessionRepo({ fs: createExecutionEnv(newRoot), sessionsRoot: newRoot });
		const sessions = await repo.list();
		const session = sessions.length > 0 ? await repo.open(sessions[0]) : await repo.create({ cwd: newRoot });
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
			async appendUser(content, timestamp, meta) {
				await appendMessage(dir, { role: "user", content, timestamp, ...(meta?.skill ? { skill: meta.skill } : {}) });
			},
			async appendAssistant(meta, timestamp) {
				const assistant: AssistantMessage & { timing?: AssistantTiming } = {
					role: "assistant",
					content: stripUndefined(meta.blocks) as AssistantMessage["content"],
					timestamp,
					api: meta.api ?? "",
					provider: meta.provider ?? "",
					model: meta.model ?? "",
					usage: meta.usage ?? EMPTY_USAGE,
					stopReason: meta.stopReason ?? "stop",
					...(meta.responseModel ? { responseModel: meta.responseModel } : {}),
					...(meta.responseId ? { responseId: meta.responseId } : {}),
					...(meta.timing ? { timing: meta.timing } : {}),
				};
				await appendMessage(dir, assistant);
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
			async appendFollowUp(timestamp) {
				await appendCustom(dir, EVENTS.followUp, { timestamp });
			},
			async appendRequestHeader(systemPrompt, tools, timestamp) {
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
				const state = await stateFor(dir);
				const entry = state.entries.filter((e) => e.type === "custom" && e.customType === EVENTS.toolResult).at(-1);
				if (!entry) throw new Error("tool/result append failed");
				return entry.id;
			},
			async appendEscalationRecord(type, details, timestamp) {
				await appendCustom(dir, type, { ...details, timestamp });
			},
			async appendCommandRun(details, timestamp) {
				await appendCustom(dir, EVENTS.commandRun, { ...details, timestamp });
			},
			async appendCommandDone(details, timestamp) {
				await appendCustom(dir, EVENTS.commandDone, { ...details, timestamp });
			},
			async appendContextChanged(details, timestamp) {
				await appendCustom(dir, EVENTS.contextChanged, { ...details, timestamp });
			},
			async lastContextChanged() {
				const state = await stateFor(dir);
				for (let i = state.entries.length - 1; i >= 0; i--) {
					const entry = state.entries[i];
					if (entry.type !== "custom" || entry.customType !== EVENTS.contextChanged) continue;
					const data = entry.data as (Partial<ContextChangedEventData> & { timestamp?: unknown }) | undefined;
					if (!data) continue;
					return {
						data: {
							workspace: typeof data.workspace === "string" ? data.workspace : null,
							storage: typeof data.storage === "string" ? data.storage : null,
							sandbox: data.sandbox ?? "workspace-write",
							skills: Array.isArray(data.skills) ? data.skills : [],
						},
						timestamp: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
					};
				}
				return null;
			},
			async appendSkillRun(details, timestamp) {
				await appendCustom(dir, EVENTS.skillRun, { ...details, timestamp });
			},
			async appendSkillDone(details, timestamp) {
				await appendCustom(dir, EVENTS.skillDone, { ...details, timestamp });
			},
			async appendShellRun(details, timestamp) {
				await appendCustom(dir, EVENTS.shellRun, { ...details, timestamp });
			},
			async appendShellDone(details, timestamp) {
				await appendCustom(dir, EVENTS.shellDone, { ...details, timestamp });
			},
			async appendRetryScheduled(details, timestamp) {
				await appendCustom(dir, EVENTS.retryScheduled, { ...details, timestamp });
			},
			async appendRetryStarted(details, timestamp) {
				await appendCustom(dir, EVENTS.retryStarted, { ...details, timestamp });
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
			async appendModelChange(model, _timestamp) {
				const state = await stateFor(dir);
				await state.session.appendEntry({ type: "model_change", id: uuidv7(), provider: model.provider, modelId: model.modelId ?? "" }, "main");
				await refreshEntries(state);
			},
			async appendThinkingLevelChange(level, _timestamp) {
				const state = await stateFor(dir);
				await state.session.appendEntry({ type: "thinking_level_change", id: uuidv7(), thinkingLevel: level }, "main");
				await refreshEntries(state);
			},
		};
	}

	return {
		scope,
		async rotateSession(dir) {
			const state = await stateFor(dir);
			const oldId = (await state.session.getMetadata()).id;
			const session = await state.repo.create({ cwd: dir, parentSessionId: oldId });
			state.session = session;
			state.entries = [];
			await refreshEntries(state);
			return (await session.getMetadata()).id;
		},
		// View: fold Origin entries through EVENT_META into the human chat transcript.
		async visibleHistory(dir) {
			const state = await stateFor(dir);
			return projectVisibleHistory(state.entries);
		},
		async lastMessage(dir) {
			const state = await stateFor(dir);
			let last: ViewItem | null = null;
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
					[EVENTS.contextChanged]: CONTEXT_CHANGED_PROJECTOR,
				},
			});
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
			const state = await stateFor(dir);
			return buildResumeTurn(state.entries, toolCallId);
		},
		async forkTo(sourceDir, targetDir) {
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
