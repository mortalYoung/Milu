import { cp, rm, stat, utimes } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { JsonlSessionRepo, Session } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type ToolResultMessage, type Usage, uuidv7 } from "@earendil-works/pi-ai";
import type { RequestTool, SandboxMode, ViewItem } from "../../shared/rpc";

export type { ViewItem } from "../../shared/rpc";

import { buildResumeTurn, foldSlice } from "../core/slice";
import { createExecutionEnv } from "../tools/execution-env";
import { projectView } from "./entry-meta";
import {
	type AgentEndReason,
	type CommandDoneEventData,
	type CommandRunEventData,
	type CompactionEventData,
	type ContextChangedEventData,
	EVENTS,
	type McpChangedEventData,
	type MemoryContextEventData,
	type MemoryRunEndEventData,
	type MemoryRunStartEventData,
	type RetryScheduledEventData,
	type RetryStartedEventData,
	type RewindEventData,
	type ShellDoneEventData,
	type ShellRunEventData,
	type SkillDoneEventData,
	type SkillRunEventData,
	type TaskEndEventData,
	type TaskStartEventData,
	type ToolResultEventData,
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
	turnStartTime: number;
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
	appendTimeGapReminder(text: string, timestamp: number): Promise<void>;
	appendRequestHeader(systemPrompt: string, tools: RequestTool[], timestamp: number): Promise<void>;
	appendAgentStart(run: number, timestamp: number): Promise<void>;
	appendAgentEnd(run: number, reason: AgentEndReason, timestamp: number, error?: string): Promise<void>;
	appendTurnStart(run: number, turn: number, timestamp: number): Promise<void>;
	appendTurnEnd(run: number, turn: number, timestamp: number): Promise<void>;
	appendToolCall(callId: string, name: string, args: unknown, run: number, turn: number, timestamp: number): Promise<void>;
	appendToolResult(result: ToolResultMessage, timestamp: number): Promise<string>;
	appendEscalationRecord(type: "escalation/request" | "escalation/decision", details: Record<string, unknown>, timestamp: number): Promise<void>;
	appendCommandRun(details: CommandRunEventData, timestamp: number): Promise<void>;
	appendCommandDone(details: CommandDoneEventData, timestamp: number): Promise<void>;
	appendMemoryRunStart(details: MemoryRunStartEventData, timestamp: number): Promise<void>;
	appendMemoryRunEnd(details: MemoryRunEndEventData, timestamp: number): Promise<void>;
	appendMemoryContext(details: MemoryContextEventData, timestamp: number): Promise<void>;
	appendContextChanged(details: ContextChangedEventData, timestamp: number): Promise<void>;
	appendInstructionsChanged(agentMd: string | null, timestamp: number): Promise<void>;
	appendMcpChanged(details: McpChangedEventData, timestamp: number): Promise<void>;
	appendRewind(details: RewindEventData, timestamp: number): Promise<string>;
	appendCompaction(details: CompactionEventData, timestamp: number): Promise<string>;
	lastContextChanged(): Promise<{ data: ContextChangedEventData; timestamp: number } | null>;
	appendSkillRun(details: SkillRunEventData, timestamp: number): Promise<void>;
	appendSkillDone(details: SkillDoneEventData, timestamp: number): Promise<void>;
	appendShellRun(details: ShellRunEventData, timestamp: number): Promise<void>;
	appendShellDone(details: ShellDoneEventData, timestamp: number): Promise<void>;
	appendTaskStart(details: TaskStartEventData, timestamp: number): Promise<void>;
	appendTaskEnd(details: TaskEndEventData, timestamp: number): Promise<void>;
	appendRetryScheduled(details: RetryScheduledEventData, timestamp: number): Promise<void>;
	appendRetryStarted(details: RetryStartedEventData, timestamp: number): Promise<void>;
	appendCompactionSummary(text: string, timestamp: number): Promise<string>;
	appendCompactionRecord(type: "compaction/start" | "compaction/end" | "compaction/prune", details: Record<string, unknown>, timestamp: number): Promise<void>;
	appendModelChange(model: { provider: string; modelId?: string }, timestamp: number): Promise<void>;
}

export interface SessionStore {
	scope(dir: string): SessionScope;
	visibleHistory(dir: string, baseDir?: string | null): Promise<ViewItem[]>;
	lastMessage(dir: string): Promise<ViewItem | null>;
	/** When the current (newest) session began — a rotated, still-empty conversation dates from here. */
	sessionStartedAt(dir: string): Promise<number>;
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
	allRawEntries(dir: string): Promise<Entry[]>;
	listSessions(dir: string): Promise<Array<{ file: string; modifiedAt: number }>>;
	sessionEntries(dir: string, file: string): Promise<Entry[]>;
	currentSessionFile(dir: string): Promise<string>;
	rotateSession(dir: string): Promise<string>;
}

interface RootState {
	repo: JsonlSessionRepo;
	session: Session;
	entries: Entry[];
}

async function dirExists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
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
		const sessions = await repo.list({ cwd: newRoot });
		if (sessions.length === 0 && !(await dirExists(newRoot))) throw new Error(`Session root is gone: ${newRoot}`);
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
			async appendTimeGapReminder(text, timestamp) {
				await appendCustom(dir, EVENTS.timeGapReminder, { text, timestamp });
			},
			async appendRequestHeader(systemPrompt, tools, timestamp) {
				await appendCustom(dir, EVENTS.requestHeader, stripUndefined({ systemPrompt, toolNames: tools.map((t) => t.name), tools, timestamp }) as Record<string, unknown>);
			},
			async appendAgentStart(run, timestamp) {
				await appendCustom(dir, EVENTS.agentStart, { run, timestamp });
			},
			async appendAgentEnd(run, reason, timestamp, error) {
				await appendCustom(dir, EVENTS.agentEnd, { run, reason, timestamp, ...(error !== undefined ? { error } : {}) });
			},
			async appendTurnStart(run, turn, timestamp) {
				await appendCustom(dir, EVENTS.turnStart, { run, turn, timestamp });
			},
			async appendTurnEnd(run, turn, timestamp) {
				await appendCustom(dir, EVENTS.turnEnd, { run, turn, timestamp });
			},
			async appendToolCall(callId, name, args, run, turn, timestamp) {
				await appendCustom(dir, EVENTS.toolCall, { callId, name, args, run, turn, timestamp });
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
			async appendMemoryRunStart(details, timestamp) {
				await appendCustom(dir, EVENTS.memoryRunStart, { ...details, timestamp });
			},
			async appendMemoryRunEnd(details, timestamp) {
				await appendCustom(dir, EVENTS.memoryRunEnd, { ...details, timestamp });
			},
			async appendMemoryContext(details, timestamp) {
				await appendCustom(dir, EVENTS.memoryContext, { ...details, timestamp });
			},
			async appendContextChanged(details, timestamp) {
				await appendCustom(dir, EVENTS.contextChanged, { ...details, timestamp });
			},
			async appendInstructionsChanged(agentMd, timestamp) {
				await appendCustom(dir, EVENTS.instructionsChanged, { agentMd, timestamp });
			},
			async appendMcpChanged(details, timestamp) {
				await appendCustom(dir, EVENTS.mcpChanged, { ...details, timestamp });
			},
			async appendRewind(details, timestamp) {
				await appendCustom(dir, EVENTS.rewind, { ...details, timestamp });
				const state = await stateFor(dir);
				const entry = state.entries.filter((e) => e.type === "custom" && e.customType === EVENTS.rewind).at(-1);
				if (!entry) throw new Error("rewind append failed");
				return entry.id;
			},
			async appendCompaction(details, timestamp) {
				await appendCustom(dir, EVENTS.compaction, { ...details, timestamp });
				const state = await stateFor(dir);
				const entry = state.entries.filter((e) => e.type === "custom" && e.customType === EVENTS.compaction).at(-1);
				if (!entry) throw new Error("compaction append failed");
				return entry.id;
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
			async appendTaskStart(details, timestamp) {
				await appendCustom(dir, EVENTS.taskStart, { ...details, timestamp });
			},
			async appendTaskEnd(details, timestamp) {
				await appendCustom(dir, EVENTS.taskEnd, { ...details, timestamp });
			},
			async appendRetryScheduled(details, timestamp) {
				await appendCustom(dir, EVENTS.retryScheduled, { ...details, timestamp });
			},
			async appendRetryStarted(details, timestamp) {
				await appendCustom(dir, EVENTS.retryStarted, { ...details, timestamp });
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
		async visibleHistory(dir, baseDir) {
			const state = await stateFor(dir);
			return projectView(state.entries, { baseDir: baseDir ?? null });
		},
		async sessionStartedAt(dir) {
			const state = await stateFor(dir);
			return (await state.session.getMetadata()).createdAt;
		},
		async lastMessage(dir) {
			const state = await stateFor(dir);
			let last: ViewItem | null = null;
			for (const entry of state.entries) {
				const time = (data: { timestamp?: unknown } | undefined) => (typeof data?.timestamp === "number" ? data.timestamp : (entry.timestamp ?? 0));
				if (entry.type === "message" && entry.message.role === "user") {
					const content = entry.message.content;
					last = { id: entry.id, kind: "user", text: typeof content === "string" ? content : "", time: entry.message.timestamp ?? 0 };
				} else if (entry.type === "custom" && entry.customType === EVENTS.sendMessage) {
					const data = entry.data as { text: string; timestamp: number } | undefined;
					if (!data) continue;
					last = { id: entry.id, kind: "send_message", text: data.text, time: data.timestamp };
				} else if (entry.type === "custom" && entry.customType === EVENTS.commandRun) {
					const data = entry.data as { commandId?: unknown; name?: unknown; timestamp?: unknown } | undefined;
					if (!data || data.commandId == null) continue;
					last = { id: entry.id, kind: "command", text: String(data.name ?? ""), time: time(data) };
				} else if (entry.type === "custom" && entry.customType === EVENTS.skillRun) {
					const data = entry.data as { skillId?: unknown; name?: unknown; timestamp?: unknown } | undefined;
					if (!data || data.skillId == null) continue;
					last = { id: entry.id, kind: "skill", text: String(data.name ?? ""), time: time(data) };
				} else if (entry.type === "custom" && entry.customType === EVENTS.shellRun) {
					const data = entry.data as { shellId?: unknown; command?: unknown; timestamp?: unknown } | undefined;
					if (!data || data.shellId == null) continue;
					last = { id: entry.id, kind: "shell", text: String(data.command ?? ""), time: time(data) };
				}
			}
			return last;
		},
		async deriveMessages(dir) {
			const state = await stateFor(dir);
			return foldSlice(state.entries);
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
			const source = await openRoot(sourceDir);
			await cp(sourceDir, targetDir, { recursive: true, force: true, filter: (src) => !src.endsWith(".tmp") });
			const sessions = await source.repo.list({ cwd: sourceDir });
			for (const dir of new Set(sessions.map((session) => basename(dirname(session.path))))) {
				await rm(join(targetDir, dir), { recursive: true, force: true });
			}
			const targetRepo = new JsonlSessionRepo({ fs: createExecutionEnv(targetDir), sessionsRoot: targetDir });
			const current = sessions[0];
			let forked = "";
			for (const session of sessions) {
				const created = await targetRepo.fork(session, { scope: "tree", cwd: targetDir });
				if (current && session.path === current.path) forked = ((await created.getMetadata()) as { path?: string }).path ?? "";
			}
			// Every fork gets a fresh mtime, so the copied order no longer says which session is current —
			// `openRoot` picks the newest, and the cleared chat has to stay that one.
			if (forked) await utimes(forked, new Date(), new Date(Date.now() + 1000));
			roots.delete(targetDir);
			await openRoot(targetDir);
		},
		evictRoot(dir) {
			roots.delete(dir);
		},
		async rawEntries(dir) {
			const state = await stateFor(dir);
			return state.entries;
		},
		async allRawEntries(dir) {
			const state = await stateFor(dir);
			const sessions = await state.repo.list({ cwd: dir });
			const seen = new Set<string>();
			const entries: Entry[] = [];
			for (const meta of sessions) {
				const session = await state.repo.open(meta);
				for (const entry of await session.findEntries({})) {
					if (seen.has(entry.id)) continue;
					seen.add(entry.id);
					entries.push(entry);
				}
			}
			return entries.sort((a, b) => a.timestamp - b.timestamp);
		},
		async listSessions(dir) {
			const state = await stateFor(dir);
			const sessions = await state.repo.list({ cwd: dir });
			return sessions.map((meta) => ({ file: meta.path, modifiedAt: meta.modifiedAt })).filter((s) => Boolean(s.file));
		},
		async sessionEntries(dir, file) {
			const state = await stateFor(dir);
			const sessions = await state.repo.list({ cwd: dir });
			const meta = sessions.find((m) => m.path === file);
			if (!meta) return [];
			const session = await state.repo.open(meta);
			const leafId = await session.getLeafId();
			const walked = leafId ? await session.findEntriesOnBranch({ start: leafId }) : [];
			return walked.reverse();
		},
		async currentSessionFile(dir) {
			const state = await stateFor(dir);
			const meta = (await state.session.getMetadata()) as { path?: string };
			return meta.path ?? "";
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
