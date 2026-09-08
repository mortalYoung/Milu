import { createHash } from "node:crypto";

import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, isContextOverflow, retryAssistantCall, type ToolResultMessage } from "@earendil-works/pi-ai";
import { contextChangedText } from "../../shared/events";
import type { RequestTool, RuntimeStatsSnapshot, SessionStats, ThinkingLevel } from "../../shared/rpc";
import { newRetryId, resolveRetryPolicy } from "../lib/retry";
import { loadSettings } from "../lib/settings";
import type { EscalationDecision, EscalationRequest, SandboxManager, SandboxMode } from "../permission";
import { Permission, policyFor } from "../permission";
import type { SessionScope } from "../persist";
import type { ContextChangedEventData } from "../persist/events";
import type { SkillsService } from "../skills/types";
import { createTools, type McpAccess } from "../tools";
import type { PartnerModel } from "./agent-config";
import { convertToLlm, resolveModel, STREAM_FN } from "./agent-config";
import { Context } from "./context";
import { projectLoopContext } from "./context-project";
import type { MemoryRecord, QueryMemoryOptions } from "./memory";
import type { PartnerPrompt } from "./prompt";

export interface AgentBridge {
	onTurnStart: (turn: number) => void;
	onMessage: (text: string) => void;
	onEnd: (error?: string) => void;
}

export interface AgentHandle {
	readonly isStreaming: boolean;
	readonly systemPrompt: string;
	readonly context: Context;
	readonly workspacePath: string | null;
	readonly storagePath: string | null;
	readonly sandboxMode: SandboxMode;
	setSandboxMode: (mode: SandboxMode) => void;
	readonly model: PartnerModel | null;
	setModel: (model: PartnerModel | null) => void;
	readonly thinkingLevel: ThinkingLevel;
	setThinkingLevel: (level: ThinkingLevel) => void;
	readonly runtimeStats: SessionStats["runtime"];
	readonly tools: RequestTool[];
	chat: (text: string) => Promise<void>;
	chatAndWait: (text: string, skill?: string) => Promise<{ ok: boolean; error?: string }>;
	sendMessage: (text: string) => Promise<void>;
	sendShellMessage: (text: string, shellId: string) => Promise<void>;
	continue: () => Promise<void>;
	invalidateSkillCatalog: () => void;
	readonly permission: Permission;
	stop: () => void;
	markUserMessage: () => void;
	reset: () => void;
	restore: (messages: AgentMessage[]) => void;
	setPartner: (partner: PartnerPrompt | null) => void;
	setStoragePath: (path: string | null) => void;
	setWorkspace: (path: string | null) => void;
	notifyContextChange: () => Promise<boolean>;
	notifySystemReminder: (content: string) => void;
}

export interface AgentDeps {
	session: SessionScope;
	initialMessages?: AgentMessage[];
	runtimeStats?: RuntimeStatsSnapshot;
	persistRuntimeStats?: (snapshot: RuntimeStatsSnapshot) => void;
	lastMessageTime?: () => Promise<number | null>;
	readMemory?: (opts: QueryMemoryOptions) => Promise<MemoryRecord[]>;
	sandbox?: SandboxManager;
	confirmEscalation?: (request: EscalationRequest) => Promise<EscalationDecision>;
	deliverIntervalMs?: () => number;
	partnerDir?: string;
	grantedSkills?: () => Promise<string[]>;
	skills?: SkillsService;
	mcp?: McpAccess;
	onContextOverflow?: () => Promise<boolean>;
	onBeforeNextTurn?: (signal?: AbortSignal) => Promise<AgentMessage[] | null>;
}

export function createAgent(bridge: AgentBridge, deps: AgentDeps): AgentHandle {
	const ctx = new Context();

	const permission = new Permission({
		sandbox: deps.sandbox,
		getPolicy: () => policyFor(ctx.workspace_path, ctx.storage_path, ctx.sandbox_mode),
		confirmEscalation: deps.confirmEscalation,
	});

	const runtime: RuntimeStatsSnapshot = {
		runs: deps.runtimeStats?.runs ?? 0,
		ttfts: [...(deps.runtimeStats?.ttfts ?? [])],
		speedOutputs: [...(deps.runtimeStats?.speedOutputs ?? [])],
		speedDurationsMs: [...(deps.runtimeStats?.speedDurationsMs ?? [])],
		lastTtft: deps.runtimeStats?.lastTtft ?? null,
		savedAt: deps.runtimeStats?.savedAt ?? 0,
		sampling: "paired",
	};

	function persistRuntime() {
		if (!deps.persistRuntimeStats) return;
		deps.persistRuntimeStats({
			...runtime,
			ttfts: [...runtime.ttfts],
			speedOutputs: [...runtime.speedOutputs],
			speedDurationsMs: [...runtime.speedDurationsMs],
			savedAt: Date.now(),
		});
	}

	let stepStartAt = 0;
	let stepStartWall = 0;
	let stepFirstDeltaAt = 0;
	let stepFirstDeltaWall = 0;

	let skillCatalogDirty = false;
	let contextDirty = true;
	const catalogDigest = (text: string) => createHash("sha256").update(text).digest("hex");
	const grantedSkills = async () => (await deps.grantedSkills?.()) ?? [];
	const skills = deps.skills
		? {
				list: async () => deps.skills!.list({ cwd: ctx.workspace_path, granted: await grantedSkills() }),
				get: async (name: string) => deps.skills!.get(name, { cwd: ctx.workspace_path, granted: await grantedSkills() }),
			}
		: null;
	function invalidateSkillCatalog() {
		skillCatalogDirty = true;
		contextDirty = true;
	}
	async function refreshSkillCatalog() {
		skillCatalogDirty = false;
		if (!skills) return;
		const list = await skills.list();
		ctx.skills = list.map((s) => ({ name: s.name, description: s.description, digest: catalogDigest(`${s.name}\n${s.description}`) }));
	}
	function currentContextSnapshot(): ContextChangedEventData {
		return { workspace: ctx.workspace_path, storage: ctx.storage_path, sandbox: ctx.sandbox_mode, skills: ctx.skills.map((s) => ({ ...s })) };
	}
	function sameContext(a: ContextChangedEventData, b: ContextChangedEventData): boolean {
		if (a.workspace !== b.workspace || a.storage !== b.storage || a.sandbox !== b.sandbox) return false;
		if (a.skills.length !== b.skills.length) return false;
		for (let i = 0; i < a.skills.length; i++) {
			const x = a.skills[i];
			const y = b.skills[i];
			if (x.name !== y.name || x.description !== y.description || x.digest !== y.digest) return false;
		}
		return true;
	}
	async function syncContextChanged(): Promise<boolean> {
		if (!contextDirty) return false;
		if (skillCatalogDirty) await refreshSkillCatalog();
		const snapshot = currentContextSnapshot();
		const last = await deps.session.lastContextChanged();
		if (last && sameContext(last.data, snapshot)) {
			contextDirty = false;
			return false;
		}
		await deps.session.appendContextChanged(snapshot, Date.now()).catch(logError);
		contextDirty = false;
		return true;
	}

	const agent = new Agent({
		initialState: projectLoopContext(ctx, [], deps.initialMessages ?? []),
		streamFn: STREAM_FN,
		convertToLlm,
		followUpMode: "one-at-a-time",
		steeringMode: "one-at-a-time",
		transformContext: async (messages) => {
			if (!skills || !(await syncContextChanged())) return messages;
			const reminder = { role: "user" as const, content: contextChangedText(currentContextSnapshot()), timestamp: Date.now() };
			agent.state.messages.push(reminder);
			return [...messages, reminder];
		},
		prepareNextTurnWithContext: async ({ context, message }, signal) => {
			if (!deps.onBeforeNextTurn) return undefined;
			if (message.content.some((block) => block.type === "toolCall")) return undefined;
			const messages = await deps.onBeforeNextTurn(signal);
			if (!messages) return undefined;
			agent.state.messages = messages;
			return { context: { ...context, messages } };
		},
	});

	function deliverVisible(text: string, timestamp: number) {
		agent.state.messages.push({
			role: "custom",
			customType: "send_message",
			content: text,
			display: true,
			timestamp,
		});
		ctx.markVisible();
		bridge.onMessage(text);
	}

	agent.state.tools = createTools({
		store: deps.session,
		permission,
		...(skills ? { skills } : {}),
		...(deps.readMemory ? { readMemory: deps.readMemory } : {}),
		...(deps.mcp ? { mcp: deps.mcp } : {}),
	});
	agent.state.systemPrompt = ctx.composeSystemPrompt();

	function assistantText(assistant: AssistantMessage): string {
		return assistant.content
			.filter((b) => b.type === "text")
			.map((b) => (b.type === "text" ? b.text : ""))
			.join("\n")
			.trim();
	}

	function autoDeliver(assistant: AssistantMessage) {
		const text = assistantText(assistant);
		if (!text) return;
		if (runHasDelivered && ctx.visibleElapsedMs() < (deps.deliverIntervalMs?.() ?? Number.POSITIVE_INFINITY)) return;
		runHasDelivered = true;
		delivered.add(assistant);
		deliverText(text);
	}
	function deliverText(text: string) {
		const timestamp = Date.now();
		void deps.session
			.appendSendMessage(text, { toolCallId: "harness-delivery" }, timestamp)
			.then(() => {
				ctx.markVisible();
				bridge.onMessage(text);
			})
			.catch((error) => console.error("session appendSendMessage failed:", error));
	}

	function enforceDelivery(event: Extract<AgentEvent, { type: "agent_end" }>) {
		if (agent.state.errorMessage) return;
		let assistant: AssistantMessage | undefined;
		for (let i = event.messages.length - 1; i >= 0; i--) {
			if (event.messages[i].role === "assistant") {
				assistant = event.messages[i] as AssistantMessage;
				break;
			}
		}
		if (!assistant) return;
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") return;
		if (assistant.content.some((b) => b.type === "toolCall")) return;
		if (delivered.has(assistant)) return;
		const text = assistantText(assistant);
		if (!text) return;
		deliverText(text);
	}

	const logError = (error: unknown) => console.error("session append failed:", error);

	let runTurn = 0;
	let step = 0;
	const delivered = new Set<AssistantMessage>();
	let runHasDelivered = false;

	const handleEvent = (event: AgentEvent): Promise<void> | void => {
		switch (event.type) {
			case "agent_start":
				runTurn += 1;
				step = 0;
				runHasDelivered = false;
				return deps.session.appendTurnStart(runTurn, Date.now()).catch(logError);
			case "turn_start":
				step += 1;
				bridge.onTurnStart(ctx.beginTurn());
				{
					const stepStart = Date.now();
					stepStartAt = performance.now();
					stepStartWall = stepStart;
					stepFirstDeltaAt = 0;
					stepFirstDeltaWall = 0;
					return Promise.all([
						deps.session.appendStepStart(runTurn, step, stepStart),
						deps.session.appendRequestHeader(
							agent.state.systemPrompt,
							agent.state.tools.map((t) => ({ name: t.name, label: t.label, description: t.description, parameters: t.parameters })),
							stepStart,
						),
					])
						.then(() => undefined)
						.catch(logError);
				}
			case "message_update": {
				const update = event.assistantMessageEvent;
				if ((update.type === "text_delta" || update.type === "thinking_delta" || update.type === "toolcall_delta") && update.delta.length > 0) {
					if (stepFirstDeltaAt === 0) {
						stepFirstDeltaAt = performance.now();
						stepFirstDeltaWall = Date.now();
					}
				}
				break;
			}
			case "message_end":
				if (event.message.role !== "assistant") break;
				if (event.message.stopReason === "error") break;
				{
					const assistant = event.message as AssistantMessage;
					const completedWall = Date.now();
					const timing = {
						stepStartTime: stepStartWall,
						firstTokenTime: stepFirstDeltaWall > 0 ? stepFirstDeltaWall : null,
						completedTime: completedWall,
					};
					return deps.session
						.appendAssistant(
							{
								blocks: assistant.content,
								usage: assistant.usage,
								timing,
								api: assistant.api,
								provider: assistant.provider,
								model: assistant.model,
								responseModel: assistant.responseModel,
								responseId: assistant.responseId,
								stopReason: assistant.stopReason,
							},
							assistant.timestamp ?? completedWall,
						)
						.then(() => {
							if (stepFirstDeltaAt > 0) {
								const ttft = stepFirstDeltaAt - stepStartAt;
								runtime.ttfts.push(ttft);
								runtime.lastTtft = ttft;
								const durationMs = completedWall - stepFirstDeltaWall;
								if (durationMs > 0) {
									runtime.speedOutputs.push(assistant.usage?.output ?? 0);
									runtime.speedDurationsMs.push(durationMs);
								}
							}
							return autoDeliver(assistant);
						})
						.catch(logError);
				}
			case "tool_execution_start":
				return deps.session.appendToolCall(event.toolCallId, event.toolName, event.args, runTurn, step, Date.now()).catch(logError);
			case "tool_execution_end": {
				const result: ToolResultMessage = {
					role: "toolResult",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					content: event.result?.content ?? [],
					details: event.result?.details,
					usage: event.result?.usage,
					...(event.result?.addedToolNames?.length ? { addedToolNames: event.result.addedToolNames } : {}),
					isError: event.isError,
					timestamp: Date.now(),
				};
				return deps.session
					.appendToolResult(result, Date.now())
					.then(() => undefined)
					.catch(logError);
			}
			case "turn_end":
				ctx.endTurn();
				runtime.runs += 1;

				persistRuntime();
				{
					const persisted = step > 0 ? deps.session.appendStepEnd(runTurn, step, Date.now()).catch(logError) : Promise.resolve();
					return persisted;
				}
			case "agent_end":
				let lastAssistant: AssistantMessage | undefined;
				for (let i = event.messages.length - 1; i >= 0; i--) {
					if (event.messages[i].role === "assistant") {
						lastAssistant = event.messages[i] as AssistantMessage;
						break;
					}
				}
				const aborted = lastAssistant?.stopReason === "aborted";
				if (deferAgentEnd) {
					deferredAgentEnd = { message: lastAssistant ?? (event.messages[event.messages.length - 1] as AssistantMessage), turn: runTurn, aborted };
					return;
				}
				ctx.setRunning(false);
				enforceDelivery(event);

				return deps.session
					.appendTurnEnd(runTurn, aborted ? "aborted" : agent.state.errorMessage ? "error" : "completed", Date.now(), agent.state.errorMessage ?? undefined)
					.catch(logError)
					.then(() => {
						bridge.onEnd(agent.state.errorMessage);
					});
			default:
				break;
		}
	};

	agent.subscribe(handleEvent);

	async function persistUser(text: string, skill?: string) {
		try {
			await deps.session.appendUser(text, Date.now(), skill ? { skill } : undefined);
		} catch (error) {
			console.error("session appendUser failed:", error);
		}
	}

	const HOUR_MS = 60 * 60 * 1000;

	function timeGapReminder(lastTime: number, now: number): string | null {
		if (lastTime <= 0) return null;
		const last = new Date(lastTime);
		const current = new Date(now);
		if (last.toDateString() === current.toDateString()) return null;
		if (now - lastTime < HOUR_MS) return null;
		return `<system_reminder>The last message was on ${last.toLocaleString()} and it is now ${current.toLocaleString()}. Time has passed since the previous exchange; take the current date and time into account when responding.</system_reminder>`;
	}

	async function pushTimeGapReminderIfNeeded(): Promise<void> {
		if (!deps.lastMessageTime) return;
		try {
			const lastTime = await deps.lastMessageTime();
			if (lastTime == null) return;
			const reminder = timeGapReminder(lastTime, Date.now());
			if (reminder) {
				await deps.session.appendTimeGapReminder(reminder, Date.now()).catch(logError);
				agent.state.messages.push({ role: "user", content: reminder, timestamp: Date.now() });
			}
		} catch {
			return;
		}
	}

	function queueFollowUp(text: string) {
		void deps.session.appendFollowUp(Date.now()).catch(logError);
		agent.followUp({
			role: "user",
			content: text,
			timestamp: Date.now(),
		});
	}

	async function prepareRun() {
		if (await syncContextChanged()) {
			agent.state.messages.push({ role: "user", content: contextChangedText(currentContextSnapshot()), timestamp: Date.now() });
		}
	}

	let runAbort: AbortController | null = null;
	let deferAgentEnd = false;
	let deferredAgentEnd: { message: AssistantMessage; turn: number; aborted: boolean } | null = null;

	function lastAssistantMessage(): AssistantMessage | null {
		for (let i = agent.state.messages.length - 1; i >= 0; i--) {
			const m = agent.state.messages[i];
			if (m.role === "assistant") return m as AssistantMessage;
		}
		return null;
	}

	function removeMessage(message: AssistantMessage) {
		agent.state.messages = agent.state.messages.filter((m) => m !== message);
	}

	async function runAttempt(text: string | null): Promise<AssistantMessage> {
		if (text != null) await agent.prompt(text);
		else await agent.continue();
		const message = lastAssistantMessage();
		if (!message) throw new Error("run ended without an assistant message");
		return message;
	}

	async function finalizeRun(message: AssistantMessage) {
		ctx.setRunning(false);
		const end = deferredAgentEnd;
		deferredAgentEnd = null;
		const turn = end?.turn ?? runTurn;
		const aborted = message.stopReason === "aborted";
		const error = message.stopReason === "error" ? message.errorMessage : undefined;
		enforceDelivery({ type: "agent_end", messages: agent.state.messages } as Extract<AgentEvent, { type: "agent_end" }>);
		await deps.session.appendTurnEnd(turn, aborted ? "aborted" : error ? "error" : "completed", Date.now(), error).catch(logError);
		bridge.onEnd(error);
	}

	async function runAttemptWithOverflowRecovery(text: string | null): Promise<AssistantMessage> {
		let overflowAttempts = 0;
		const maxOverflow = (await loadSettings()).compaction?.maxOverflowRetries ?? 1;
		for (;;) {
			const message = await runAttempt(text);
			if (!isContextOverflow(message, agent.state.model?.contextWindow) || overflowAttempts >= maxOverflow || !deps.onContextOverflow) {
				return message;
			}
			const recovered = await deps.onContextOverflow();
			if (!recovered) return message;
			overflowAttempts += 1;
			removeMessage(message);
		}
	}

	async function runWithRetry(text: string | null): Promise<AssistantMessage> {
		if (text != null) await prepareRun();
		const policy = resolveRetryPolicy(await loadSettings());
		runAbort = new AbortController();
		deferAgentEnd = true;
		let lastFailed: AssistantMessage | null = null;
		let scheduled: { retryId: string; retry: number } | null = null;
		try {
			const message = policy.enabled
				? await retryAssistantCall(
						async () => {
							if (lastFailed) removeMessage(lastFailed);
							const message = await runAttemptWithOverflowRecovery(text);
							if (message.stopReason === "error") lastFailed = message;
							return message;
						},
						policy,
						runAbort.signal,
						{
							onRetryScheduled: (attempt, maxRetries, delayMs, errorMessage) => {
								const retryId = newRetryId();
								scheduled = { retryId, retry: attempt };
								void deps.session
									.appendRetryScheduled(
										{
											retryId,
											turn: ctx.turn,
											step,
											provider: ctx.model?.provider ?? "unknown",
											model: ctx.model?.modelId ?? "unknown",
											retry: attempt,
											maxRetries,
											delayMs,
											errorMessage,
										},
										Date.now(),
									)
									.catch(logError);
							},
							onRetryAttemptStart: () => {
								if (!scheduled) return;
								void deps.session.appendRetryStarted({ retryId: scheduled.retryId, turn: ctx.turn, step, retry: scheduled.retry }, Date.now()).catch(logError);
							},
						},
					)
				: await runAttemptWithOverflowRecovery(text);
			await finalizeRun(message);
			return message;
		} finally {
			deferAgentEnd = false;
			if (ctx.running && !deferredAgentEnd) ctx.setRunning(false);
		}
	}

	async function promptAndWait(text: string, skill?: string): Promise<{ ok: boolean; error?: string }> {
		if (text.trim() === "") return { ok: false, error: "empty message" };
		await pushTimeGapReminderIfNeeded();
		await persistUser(text, skill);
		ctx.markUserMessage();
		if (ctx.running) return { ok: false, error: "agent is running" };
		ctx.setRunning(true);
		try {
			const message = await runWithRetry(text);
			return { ok: message.stopReason !== "error", error: message.stopReason === "error" ? message.errorMessage : undefined };
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	return {
		get isStreaming() {
			return agent.state.isStreaming;
		},
		get context() {
			return ctx;
		},
		get systemPrompt() {
			return agent.state.systemPrompt;
		},
		get workspacePath() {
			return ctx.workspace_path;
		},
		get storagePath() {
			return ctx.storage_path;
		},
		get sandboxMode() {
			return ctx.sandbox_mode;
		},
		setSandboxMode(mode: SandboxMode) {
			ctx.sandbox_mode = mode;
			contextDirty = true;
		},
		get model() {
			return ctx.model;
		},
		setModel(model: PartnerModel | null) {
			const resolved = resolveModel(model ?? undefined);
			ctx.model = model;
			agent.state.model = resolved;
		},
		get thinkingLevel() {
			return ctx.thinkingLevel;
		},
		setThinkingLevel(level: ThinkingLevel) {
			ctx.setThinkingLevel(level);
			agent.state.thinkingLevel = ctx.thinkingLevel;
		},
		get runtimeStats(): SessionStats["runtime"] {
			const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
			const totalOutput = runtime.speedOutputs.reduce((a, b) => a + b, 0);
			const totalDurationMs = runtime.speedDurationsMs.reduce((a, b) => a + b, 0);
			return {
				runs: runtime.runs,
				avgTtftMs: avg(runtime.ttfts),
				avgTps: totalDurationMs > 0 ? totalOutput / (totalDurationMs / 1000) : null,
				lastTtftMs: runtime.lastTtft,
			};
		},
		get tools(): RequestTool[] {
			return agent.state.tools.map((t) => ({ name: t.name, label: t.label, description: t.description, parameters: t.parameters }));
		},
		get permission() {
			return permission;
		},
		async continue() {
			if (ctx.running) return;
			ctx.setRunning(true);
			try {
				await runWithRetry(null);
			} catch (error) {
				ctx.setRunning(false);
				console.error("agent.continue failed:", error);
			}
		},
		async chat(text: string) {
			if (text.trim() === "") return;
			await pushTimeGapReminderIfNeeded();
			await persistUser(text);
			ctx.markUserMessage();
			if (ctx.running) {
				queueFollowUp(text);
				return;
			}
			ctx.setRunning(true);
			void runWithRetry(text).catch(() => queueFollowUp(text));
		},
		chatAndWait: promptAndWait,
		async sendMessage(text: string) {
			const timestamp = Date.now();
			await deps.session.appendSendMessage(text, { toolCallId: "command" }, timestamp);
			deliverVisible(text, timestamp);
		},
		async sendShellMessage(text: string, shellId: string) {
			const timestamp = Date.now();
			await deps.session.appendSendMessage(text, { toolCallId: `shell:${shellId}` }, timestamp);
			deliverVisible(text, timestamp);
		},
		stop() {
			agent.abort();
			runAbort?.abort();
		},
		markUserMessage() {
			ctx.markUserMessage();
		},
		reset() {
			agent.reset();
			ctx.reset();
		},
		restore(messages: AgentMessage[]) {
			agent.state.messages = messages;
		},
		setPartner(partner: PartnerPrompt | null) {
			ctx.setPartner(partner);
			agent.state.systemPrompt = ctx.composeSystemPrompt();
		},
		setStoragePath(path: string | null) {
			ctx.storage_path = path;
			contextDirty = true;
		},
		setWorkspace(path: string | null) {
			ctx.workspace_path = path;
			invalidateSkillCatalog();
		},
		async notifyContextChange() {
			if (!(await syncContextChanged())) return false;
			agent.state.messages.push({ role: "user", content: contextChangedText(currentContextSnapshot()), timestamp: Date.now() });
			return true;
		},
		notifySystemReminder(content: string) {
			agent.state.messages.push({ role: "user", content, timestamp: Date.now() });
		},
		invalidateSkillCatalog() {
			skillCatalogDirty = true;
			contextDirty = true;
		},
	};
}
