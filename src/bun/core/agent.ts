import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { RequestTool, RuntimeStatsSnapshot, SessionStats, ThinkingLevel } from "../../shared/rpc";
import type { EscalationDecision, EscalationRequest, SandboxManager, SandboxMode } from "../permission";
import { Permission, policyFor } from "../permission";
import type { SessionScope } from "../persist";
import { createTools } from "../tools";
import type { PartnerModel } from "./agent-config";
import { convertToLlm, resolveModel, STREAM_FN } from "./agent-config";
import { AgentContext, appendSystemReminder } from "./context";
import type { PartnerPrompt } from "./prompt";

export interface AgentBridge {
	onTurnStart: (turn: number) => void;
	onMessage: (text: string) => void;
	onTrajectoryUpdate: () => void;
	onWorkspaceUpdate: () => void;
	onWorkspaceSet?: (path: string) => void;
	onEnd: (error?: string) => void;
}

export interface AgentHandle {
	readonly isStreaming: boolean;
	readonly systemPrompt: string;
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
	continue: () => Promise<void>;
	readonly permission: Permission;
	stop: () => void;
	markUserMessage: () => void;
	reset: () => void;
	restore: (messages: AgentMessage[]) => void;
	setPartner: (partner: PartnerPrompt | null) => void;
	setStoragePath: (path: string | null) => void;
	setWorkspace: (path: string | null) => void;
}

export interface AgentDeps {
	session: SessionScope;
	initialMessages?: AgentMessage[];
	runtimeStats?: RuntimeStatsSnapshot;
	persistRuntimeStats?: (snapshot: RuntimeStatsSnapshot) => void;
	sandbox?: SandboxManager;
	confirmEscalation?: (request: EscalationRequest) => Promise<EscalationDecision>;
	deliverIntervalMs?: () => number;
}

export function createAgent(bridge: AgentBridge, deps: AgentDeps): AgentHandle {
	const ctx = new AgentContext();

	const permission = new Permission({
		sandbox: deps.sandbox,
		getPolicy: () => policyFor(ctx.workspace_path, ctx.storage_path, ctx.sandbox_mode),
		confirmEscalation: deps.confirmEscalation,
	});

	const runtime: RuntimeStatsSnapshot = {
		runs: deps.runtimeStats?.runs ?? 0,
		ttfts: [...(deps.runtimeStats?.ttfts ?? [])],
		speeds: [...(deps.runtimeStats?.speeds ?? [])],
		lastTtft: deps.runtimeStats?.lastTtft ?? null,
		savedAt: deps.runtimeStats?.savedAt ?? 0,
		sampling: "per-step",
	};

	function persistRuntime() {
		if (!deps.persistRuntimeStats) return;
		deps.persistRuntimeStats({
			...runtime,
			ttfts: [...runtime.ttfts],
			speeds: [...runtime.speeds],
			savedAt: Date.now(),
		});
	}

	let stepStartAt = 0;
	let stepStartWall = 0;
	let stepFirstDeltaAt = 0;
	let stepFirstDeltaWall = 0;
	let stepLastDeltaAt = 0;

	const agent = new Agent({
		initialState: {
			systemPrompt: ctx.composeSystemPrompt(),
			model: resolveModel(ctx.model ?? undefined),
			thinkingLevel: ctx.thinkingLevel,
			tools: [],
			messages: deps.initialMessages ?? [],
		},
		streamFn: STREAM_FN,
		convertToLlm,
		followUpMode: "one-at-a-time",
		steeringMode: "one-at-a-time",
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
		onSetWorkspace: (workspace: string): { ok: true; path: string } | { ok: false; error: string } => {
			const decision = permission.setWorkspace(workspace);
			if (!decision.allowed) return { ok: false, error: decision.reason };
			ctx.workspace_path = decision.resolved;
			bridge.onWorkspaceUpdate();
			bridge.onWorkspaceSet?.(decision.resolved);
			return { ok: true, path: decision.resolved };
		},
	});
	agent.state.systemPrompt = ctx.composeSystemPrompt();

	function persistReminder(text: string) {
		void deps.session.appendReminder(`<system_reminder>${text}</system_reminder>`, Date.now()).catch((error) => console.error("session appendReminder failed:", error));
	}

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
			.then(() => deliverVisible(text, timestamp))
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
					stepLastDeltaAt = 0;
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
			case "message_update":
				if (event.assistantMessageEvent.type === "text_delta") {
					if (stepFirstDeltaAt === 0) {
						stepFirstDeltaAt = performance.now();
						stepFirstDeltaWall = Date.now();
					}
					stepLastDeltaAt = performance.now();
				}
				break;
			case "message_end":
				if (event.message.role !== "assistant") break;
				{
					const assistant = event.message as AssistantMessage;
					const completedWall = Date.now();
					const timing = {
						stepStartTime: stepStartWall,
						firstTokenTime: stepFirstDeltaWall > 0 ? stepFirstDeltaWall : null,
						completedTime: completedWall,
					};
					return deps.session
						.appendAssistant({ blocks: assistant.content, usage: assistant.usage, timing }, assistant.timestamp ?? completedWall)
						.then(() => {
							if (stepFirstDeltaAt > 0 && stepLastDeltaAt >= stepFirstDeltaAt) {
								const ttft = stepFirstDeltaAt - stepStartAt;
								const seconds = (stepLastDeltaAt - stepFirstDeltaAt) / 1000;
								if (seconds > 0) {
									const output = assistant.usage?.output ?? 0;
									runtime.ttfts.push(ttft);
									runtime.lastTtft = ttft;
									runtime.speeds.push(output / seconds);
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
				return deps.session.appendToolResult(result, Date.now()).catch(logError);
			}
			case "turn_end":
				ctx.endTurn();
				runtime.runs += 1;

				persistRuntime();
				{
					const persisted = step > 0 ? deps.session.appendStepEnd(runTurn, step, Date.now()).catch(logError) : Promise.resolve();
					return persisted.then(() => bridge.onTrajectoryUpdate());
				}
			case "agent_end":
				ctx.setRunning(false);
				enforceDelivery(event);
				let lastAssistant: AssistantMessage | undefined;
				for (let i = event.messages.length - 1; i >= 0; i--) {
					if (event.messages[i].role === "assistant") {
						lastAssistant = event.messages[i] as AssistantMessage;
						break;
					}
				}
				const aborted = lastAssistant?.stopReason === "aborted";

				return deps.session
					.appendTurnEnd(runTurn, aborted ? "aborted" : agent.state.errorMessage ? "error" : "completed", Date.now(), agent.state.errorMessage ?? undefined)
					.catch(logError)
					.then(() => {
						bridge.onTrajectoryUpdate();
						bridge.onEnd(agent.state.errorMessage);
					});
			default:
				break;
		}
	};

	agent.subscribe(handleEvent);

	async function persistUser(text: string) {
		try {
			await deps.session.appendUser(text, Date.now());
		} catch (error) {
			console.error("session appendUser failed:", error);
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

	async function runPrompt(text: string) {
		const conversationStart = agent.state.messages.length === 0;
		if (ctx.workspace_path == null) {
			const reminder = "The workspace is not set yet. Remember to call `set_workspace` with the task's absolute path before other tools if the task needs file or command access.";
			persistReminder(reminder);
			appendSystemReminder(agent.state.messages, reminder);
		}
		if (conversationStart) {
			const context =
				`Current workspace: ${ctx.workspace_path ?? "unset"}.\n` + `Current storage: ${ctx.storage_path ?? "unset"}.\n` + `Current sandbox mode: ${ctx.sandbox_mode}.`;
			persistReminder(context);
			appendSystemReminder(agent.state.messages, context);
		}

		await agent.prompt(text);
	}

	return {
		get isStreaming() {
			return agent.state.isStreaming;
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
			ctx.thinkingLevel = level;
			agent.state.thinkingLevel = level as never;
		},
		get runtimeStats(): SessionStats["runtime"] {
			const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
			return { runs: runtime.runs, avgTtftMs: avg(runtime.ttfts), avgTps: avg(runtime.speeds), lastTtftMs: runtime.lastTtft };
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
				await agent.continue();
			} catch (error) {
				ctx.setRunning(false);
				console.error("agent.continue failed:", error);
			}
		},
		async chat(text: string) {
			if (text.trim() === "") return;
			await persistUser(text);
			ctx.markUserMessage();
			if (ctx.running) {
				queueFollowUp(text);
				return;
			}
			ctx.setRunning(true);
			void runPrompt(text).catch(() => queueFollowUp(text));
		},
		stop() {
			agent.abort();
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
		},
		setWorkspace(path: string | null) {
			ctx.workspace_path = path;
			bridge.onWorkspaceUpdate();
		},
	};
}
