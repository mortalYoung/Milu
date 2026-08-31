import { cp } from "node:fs/promises";
import type { AgentMessage, CustomEntry, Entry } from "@earendil-works/pi-agent-core";
import { buildSessionContext, JsonlSessionRepo, Session } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type ToolResultMessage, type Usage, uuidv7 } from "@earendil-works/pi-ai";
import type { CommandHistoryItem, EscalationStatus, RequestTool, SandboxMode, ThinkingLevel } from "../../shared/rpc";
import type { Surface, SurfaceOpRecord } from "../../shared/surface";
import { buildResumeTurn, contextChangedText, deriveMessages as deriveSurfaceMessages, dropDanglingTurn, foldSurface, pairToolResults } from "../core/surface";
import { createExecutionEnv } from "../tools/execution-env";
import {
	type CommandDoneEventData,
	type CommandRunEventData,
	type ContextChangedEventData,
	EVENTS,
	type RetryScheduledEventData,
	type RetryStartedEventData,
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

export interface VisibleItem {
	id: string;
	kind: "user" | "send_message" | "escalation" | "error" | "aborted" | "command" | "skill";
	text: string;
	time: number;
	escalation?: {
		id: string;
		command: string;
		from: SandboxMode;
		to: SandboxMode;
		justification: string;
		status: EscalationStatus;
	};
	command?: CommandHistoryItem;
	skill?: CommandHistoryItem;
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
	appendToolResult(result: ToolResultMessage, timestamp: number): Promise<void>;
	appendEscalationRecord(type: "escalation/request" | "escalation/decision", details: Record<string, unknown>, timestamp: number): Promise<void>;
	appendCommandRun(details: CommandRunEventData, timestamp: number): Promise<void>;
	appendCommandDone(details: CommandDoneEventData, timestamp: number): Promise<void>;
	appendContextChanged(details: ContextChangedEventData, timestamp: number): Promise<void>;
	lastContextChanged(): Promise<{ data: ContextChangedEventData; timestamp: number } | null>;
	appendSkillRun(details: SkillRunEventData, timestamp: number): Promise<void>;
	appendSkillDone(details: SkillDoneEventData, timestamp: number): Promise<void>;
	appendRetryScheduled(details: RetryScheduledEventData, timestamp: number): Promise<void>;
	appendRetryStarted(details: RetryStartedEventData, timestamp: number): Promise<void>;
	appendSurfaceOp(op: SurfaceOpRecord, timestamp: number): Promise<void>;
	appendCompactionSummary(text: string, timestamp: number): Promise<string>;
	appendCompactionRecord(type: "compaction/start" | "compaction/end", details: Record<string, unknown>, timestamp: number): Promise<void>;
	appendModelChange(model: { provider: string; modelId?: string }, timestamp: number): Promise<void>;
	appendThinkingLevelChange(level: ThinkingLevel, timestamp: number): Promise<void>;
}

export interface SessionStore {
	scope(dir: string): SessionScope;
	visibleHistory(dir: string): Promise<VisibleItem[]>;
	lastMessage(dir: string): Promise<VisibleItem | null>;
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
		async visibleHistory(dir) {
			const state = await stateFor(dir);
			const decisions = new Map<string, { approved: boolean; reason?: string }>();
			for (const entry of state.entries) {
				if (entry.type !== "custom" || entry.customType !== EVENTS.escalationDecision) continue;
				const data = entry.data as { escalationId?: unknown; approved?: unknown } | undefined;
				if (data?.escalationId == null) continue;
				decisions.set(String(data.escalationId), { approved: data.approved === true });
			}
			const commandDones = new Map<string, { kind: "success" | "error"; text?: string }>();
			for (const entry of state.entries) {
				if (entry.type !== "custom" || entry.customType !== EVENTS.commandDone) continue;
				const data = entry.data as Partial<CommandDoneEventData> | undefined;
				if (data?.commandId == null) continue;
				commandDones.set(String(data.commandId), { kind: data.kind === "error" ? "error" : "success", ...(typeof data.text === "string" ? { text: data.text } : {}) });
			}
			const skillDones = new Map<string, { kind: "success" | "error"; text?: string }>();
			for (const entry of state.entries) {
				if (entry.type !== "custom" || entry.customType !== EVENTS.skillDone) continue;
				const data = entry.data as Partial<SkillDoneEventData> | undefined;
				if (data?.skillId == null) continue;
				skillDones.set(String(data.skillId), { kind: data.kind === "error" ? "error" : "success", ...(typeof data.text === "string" ? { text: data.text } : {}) });
			}
			return state.entries.flatMap((entry): VisibleItem[] => {
				if (entry.type === "message" && entry.message.role === "user") {
					const content = entry.message.content;
					const skill = (entry.message as { skill?: unknown }).skill;
					return [
						{
							id: entry.id,
							kind: "user",
							text: typeof content === "string" ? content : "",
							time: entry.message.timestamp ?? 0,
							...(typeof skill === "string" ? { skillName: skill } : {}),
						},
					];
				}
				if (entry.type === "custom" && entry.customType === EVENTS.sendMessage) {
					const data = entry.data as { text: string; timestamp: number } | undefined;
					if (!data) return [];
					return [{ id: entry.id, kind: "send_message", text: data.text, time: data.timestamp }];
				}
				if (entry.type === "custom" && entry.customType === EVENTS.turnEnd) {
					const data = entry.data as { reason?: unknown; error?: unknown; timestamp?: unknown } | undefined;
					if (data?.reason === "aborted") {
						return [{ id: entry.id, kind: "aborted", text: "stopped", time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0) }];
					}
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
				if (entry.type === "custom" && entry.customType === EVENTS.commandRun) {
					const data = entry.data as (Partial<CommandRunEventData> & { timestamp?: unknown }) | undefined;
					if (data?.commandId == null) return [];
					const done = commandDones.get(String(data.commandId));
					const name = String(data.name ?? "");
					return [
						{
							id: entry.id,
							kind: "command",
							text: name,
							time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
							command: {
								commandId: String(data.commandId),
								name,
								...(typeof data.args === "string" ? { args: data.args } : {}),
								status: done ? done.kind : "running",
							},
						},
					];
				}
				if (entry.type === "custom" && entry.customType === EVENTS.skillRun) {
					const data = entry.data as (Partial<SkillRunEventData> & { timestamp?: unknown }) | undefined;
					if (data?.skillId == null) return [];
					const done = skillDones.get(String(data.skillId));
					const name = String(data.name ?? "");
					return [
						{
							id: entry.id,
							kind: "skill",
							text: name,
							time: typeof data.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0),
							skill: {
								commandId: String(data.skillId),
								name,
								...(typeof data.hint === "string" && data.hint ? { args: data.hint } : {}),
								status: done ? done.kind : "running",
							},
						},
					];
				}
				return [];
			});
		},
		async lastMessage(dir) {
			const state = await stateFor(dir);
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
