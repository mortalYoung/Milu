/**
 * The double-loop agent runtime (pi-agent-core).
 * How the loop runs — not what the agent is (see agent-config.ts).
 *
 * - Inner loop: stream the LLM response, execute any tool calls, feed the
 *   results back to the model, repeat until the model stops.
 * - Outer loop: after a turn settles, drain queued steering / follow-up
 *   messages and keep running until nothing is left.
 *
 * Persistence: pi awaits event listeners (subscription order), so the listener
 * here doubles as the write path's checkpoint surface — every awaited append
 * is durable before the loop proceeds:
 *   - turn_start   → step/start + request/header BEFORE the LLM call is dispatched
 *   - message_end  → the assistant turn's message, once the stream settles
 *   - tool_execution_start → tool/call BEFORE the tool runs
 *   - tool_execution_end   → tool/result, right after the tool finishes
 *   - turn_end     → step/end (previous step's records are all on disk first)
 *   - agent_start/end → turn/start · turn/end (one run = one turn)
 * The user only sees `send_message` output, delivered through the bridge's onMessage.
 */
import { resolve } from "node:path";
import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { RuntimeStatsSnapshot, SessionStats } from "../../shared/rpc";
import { validateWorkspace } from "../lib/workspace";
import type { SessionScope } from "../persist";
import type { SandboxManager } from "../sandbox";
import type { EscalationDecision, EscalationRequest, SandboxMode } from "../sandbox/types";
import { createTools } from "../tools";
import { convertToLlm, resolveModel, STREAM_FN } from "./agent-config";
import { AgentContext, appendSystemReminder } from "./context";
import type { PartnerPrompt } from "./prompt";

export interface AgentBridge {
	/** A new turn began (one LLM call + tool executions). */
	onTurnStart: (turn: number) => void;
	/** A visible message was sent to the user via send_message. */
	onMessage: (text: string) => void;
	/** A turn has been persisted (trajectory has new data); fired after persistence completes so a fetch is always up to date. */
	onTrajectoryUpdate: () => void;
	/** The workspace was set via set_workspace (the view shows it near the input). */
	onWorkspaceUpdate: () => void;
	/** The workspace was accepted and resolved (optional; persist it — e.g. per-partner file — so it survives restart). */
	onWorkspaceSet?: (path: string) => void;
	/** The run settled. `error` is set on failure (e.g. missing API key). */
	onEnd: (error?: string) => void;
}

export interface AgentHandle {
	/** True while the agent is streaming or awaiting tool results. */
	readonly isStreaming: boolean;
	/** The current system prompt (rebuilt on setPartner; the prompt is static otherwise). */
	readonly systemPrompt: string;
	/** The current workspace (null until set_workspace); the view shows it near the input. */
	readonly workspacePath: string | null;
	/** The current storage directory (partner-scoped; part of the path guard for tool effects). */
	readonly storagePath: string | null;
	/** The current confinement mode (per partner); the composer select shows it. */
	readonly sandboxMode: SandboxMode;
	/** Set the confinement mode for tool effects (persisted by the caller per partner). */
	setSandboxMode: (mode: SandboxMode) => void;
	/** In-memory run timing (TTFT / tok/s), averaged across every streamed LLM call this process made. */
	readonly runtimeStats: SessionStats["runtime"];
	/** Send a user message (resolves after persistence); queued as a follow-up while busy. */
	chat: (text: string) => Promise<void>;
	/** Resume a run from a restored context ending in a tool result (restart-resume after an approved escalation). */
	continue: () => Promise<void>;
	/** Abort the current run. */
	stop: () => void;
	/** User sent a message: refresh the visible clock (the progress-notification countdown restarts). */
	markUserMessage: () => void;
	/** Wipe the transcript. */
	reset: () => void;
	/** Startup restore: replace the in-memory transcript with the persisted message chain. */
	restore: (messages: AgentMessage[]) => void;
	/** Switch Partner: rebuild the system prompt from the profile fields (responsibilities/tones). */
	setPartner: (partner: PartnerPrompt | null) => void;
	/** Set the agent's storage directory (delivered via system_reminder; the prompt stays static). */
	setStoragePath: (path: string | null) => void;
	/** Set the agent's workspace (delivered via system_reminder; the prompt stays static). */
	setWorkspace: (path: string | null) => void;
	/** Compose a trial system prompt from the profile fields (for preview; does not change agent state). */
	previewSystemPrompt: (partner: PartnerPrompt | null) => string;
}

export interface AgentDeps {
	/** Conversation persistence, scoped to this agent's session root. */
	session: SessionScope;
	/** The initial message chain to restore (see toAgentMessages). */
	initialMessages?: AgentMessage[];
	/** Runtime timing samples from a previous launch (loaded from disk; see runtime-stats.ts). */
	runtimeStats?: RuntimeStatsSnapshot;
	/** Write-through hook: persist the raw timing samples after every sampled turn. */
	persistRuntimeStats?: (snapshot: RuntimeStatsSnapshot) => void;
	/** Sandbox manager (mounted on macOS); absent ⇒ tools run unconfined. */
	sandbox?: SandboxManager;
	/** Human approval gate for escalation retries (wired to escalation records + the inline transcript bubble). */
	confirmEscalation?: (request: EscalationRequest) => Promise<EscalationDecision>;
}

/**
 * Per-LLM-call timing samples: TTFT (turn start → first text delta) and output speed
 * (tokens per second between first and last delta). The raw samples are persisted to disk
 * (see runtime-stats.ts) — the runtime object here is the live copy, written through after
 * every sampled turn, so the averages survive restarts. Token usage totals are persisted
 * separately through the session store (see aggregateUsage).
 */

export function createAgent(bridge: AgentBridge, deps: AgentDeps): AgentHandle {
	const ctx = new AgentContext();

	const runtime: RuntimeStatsSnapshot = {
		runs: deps.runtimeStats?.runs ?? 0,
		ttfts: [...(deps.runtimeStats?.ttfts ?? [])],
		speeds: [...(deps.runtimeStats?.speeds ?? [])],
		lastTtft: deps.runtimeStats?.lastTtft ?? null,
		savedAt: deps.runtimeStats?.savedAt ?? 0,
	};

	/** Write the raw samples through to disk (fire-and-forget; the callback owns error handling). */
	function persistRuntime() {
		if (!deps.persistRuntimeStats) return;
		deps.persistRuntimeStats({
			...runtime,
			ttfts: [...runtime.ttfts],
			speeds: [...runtime.speeds],
			savedAt: Date.now(),
		});
	}
	// Per-turn sampling state, reset on every turn_start
	let turnStartAt = 0;
	let firstDeltaAt = 0;
	let lastDeltaAt = 0;

	const agent = new Agent({
		initialState: {
			// Tools are not mounted yet, so the initial list is empty; rebuilt via ctx.setTools after mounting
			systemPrompt: ctx.composeSystemPrompt(),
			model: resolveModel(),
			thinkingLevel: "high",
			tools: [],
			messages: deps.initialMessages ?? [],
		},
		streamFn: STREAM_FN,
		convertToLlm,
		// One queued message at a time, oldest first.
		followUpMode: "one-at-a-time",
		steeringMode: "one-at-a-time",
	});

	// A visible message lands in three places: persisted session entry (the tool does it), agent context,
	// and the bridge signal. The context push + signal are shared by the send_message tool and the direct
	// final-delivery fallback (deliverText).
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

	// Tools need the agent instance (to write visible messages back into the agent context), so mount after construction.
	// The path guard reads the workspace/storage roots from the context (null = unset).
	agent.state.tools = createTools({
		store: deps.session,
		onVisibleMessage: (text, timestamp) => deliverVisible(text, timestamp),
		guard: {
			workspaceRoot: () => ctx.workspace_path,
			storageRoot: () => ctx.storage_path,
		},
		sandbox: deps.sandbox
			? {
					manager: deps.sandbox,
					getMode: () => ctx.sandbox_mode,
				}
			: undefined,
		confirmEscalation: deps.confirmEscalation,
		// set_workspace: once per conversation, absolute path, must exist, not inside storage.
		// Returns the resolved path so the tool can read the workspace's instructions file from it.
		onSetWorkspace: (workspace: string): { ok: true; path: string } | { ok: false; error: string } => {
			const error = validateWorkspace(workspace, { current: ctx.workspace_path, storagePath: ctx.storage_path });
			if (error) return { ok: false, error };
			const resolved = resolve(workspace);
			ctx.workspace_path = resolved;
			bridge.onWorkspaceUpdate();
			bridge.onWorkspaceSet?.(resolved);
			return { ok: true, path: resolved };
		},
	});
	agent.state.systemPrompt = ctx.composeSystemPrompt();

	/** Persist a reminder (custom entry) so the trajectory timeline shows it — verbatim as the model sees it, with the <system_reminder> wrapper. */
	function persistReminder(text: string) {
		void deps.session.appendReminder(`<system_reminder>${text}</system_reminder>`, Date.now()).catch((error) => console.error("session appendReminder failed:", error));
	}

	/**
	 * 20s progress reminder, fired only for tool steps (see turn_end): a text-only step means the model
	 * already stopped, so there is no work in flight to report — its final text is delivered by enforceDelivery.
	 * Steering queues a message the outer loop always drains, driving a new turn.
	 */
	function notifyIfSilent() {
		if (!ctx.shouldNotify()) return;
		const secs = Math.round(ctx.visibleElapsedMs() / 1000);
		const content = `You've been working ~${secs}s without sending the user anything visible. Call \`send_message\` now with a brief progress update, then continue.`;
		persistReminder(content);
		agent.steer({
			role: "user",
			content: `<system_reminder>${content}</system_reminder>`,
			timestamp: Date.now(),
		});
	}

	/** Deliver the model's text as a visible message on its behalf (persist + context + signal). */
	function deliverText(text: string) {
		const timestamp = Date.now();
		void deps.session
			.appendSendMessage(text, { toolCallId: "harness-delivery" }, timestamp)
			.then(() => deliverVisible(text, timestamp))
			.catch((error) => console.error("session appendSendMessage failed:", error));
	}

	/**
	 * End-of-run delivery: the user must always receive the model's final answer. If the run's last
	 * assistant message is plain text (no tool calls, not an error/abort), deliver it via send_message —
	 * models sometimes finish with a plain text answer instead of calling send_message. Runs that failed
	 * (agent_end already reports the error through bridge.onEnd) or ended on a tool turn have nothing to deliver.
	 */
	function enforceDelivery(event: Extract<AgentEvent, { type: "agent_end" }>) {
		if (agent.state.errorMessage) return; // failed run — the agent_end handler already reports the error
		// The run's last LLM output is its last assistant message (event.messages = this run's chain).
		let assistant: AssistantMessage | undefined;
		for (let i = event.messages.length - 1; i >= 0; i--) {
			if (event.messages[i].role === "assistant") {
				assistant = event.messages[i] as AssistantMessage;
				break;
			}
		}
		if (!assistant) return; // no model output this run
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") return;
		if (assistant.content.some((b) => b.type === "toolCall")) return; // ended on a tool turn — send_message was the visible output
		const text = assistant.content
			.filter((b) => b.type === "text")
			.map((b) => (b.type === "text" ? b.text : ""))
			.join("\n")
			.trim();
		if (!text) return; // nothing to deliver
		deliverText(text);
	}

	/** A failed append must never break the run (pi awaits listeners — a rejection would fail it). */
	const logError = (error: unknown) => console.error("session append failed:", error);

	// Persisted turn/step numbering: one run (agent_start → agent_end) is a turn; each pi turn
	// (turn_start → turn_end) — one LLM call plus its tool executions — is a step within the run.
	let runTurn = 0;
	let step = 0;
	// Whether this step called any tool — only tool steps get the 20s progress reminder (see turn_end)
	let stepHadTool = false;

	const handleEvent = (event: AgentEvent): Promise<void> | void => {
		switch (event.type) {
			case "agent_start":
				runTurn += 1;
				step = 0;
				return deps.session.appendTurnStart(runTurn, Date.now()).catch(logError);
			case "turn_start":
				step += 1;
				stepHadTool = false;
				bridge.onTurnStart(ctx.beginTurn());
				// Flush-before-request checkpoint: step marker + request header (system prompt +
				// resolved tool names — invariant 1: model-visible ⟺ logged) are on disk before
				// the LLM call is dispatched. Sampling window: the step is one LLM call.
				turnStartAt = performance.now();
				firstDeltaAt = 0;
				lastDeltaAt = 0;
				return Promise.all([
					deps.session.appendStepStart(runTurn, step, Date.now()),
					deps.session.appendRequestHeader(
						agent.state.systemPrompt,
						agent.state.tools.map((t) => t.name),
						Date.now(),
					),
				])
					.then(() => undefined)
					.catch(logError);
			case "message_update":
				// First text token = TTFT; keep the last delta for the output speed window
				if (event.assistantMessageEvent.type === "text_delta") {
					if (firstDeltaAt === 0) firstDeltaAt = performance.now();
					lastDeltaAt = performance.now();
				}
				break;
			case "message_end":
				// The stream settled: persist the step's assistant message now, before any tool runs
				// (message_end also fires for user prompts and toolResult bookkeeping — only assistant
				// output enters the log here). A failed stream lands as its error message entry.
				if (event.message.role !== "assistant") break;
				{
					const assistant = event.message as AssistantMessage;
					return deps.session.appendAssistant({ blocks: assistant.content, usage: assistant.usage }, assistant.timestamp ?? Date.now()).catch(logError);
				}
			case "tool_execution_start":
				// Flush-before-execute checkpoint: the call is in the log before the tool runs
				stepHadTool = true;
				return deps.session.appendToolCall(event.toolCallId, event.toolName, event.args, runTurn, step, Date.now()).catch(logError);
			case "tool_execution_end": {
				// The result is durable right after the tool finishes — a mid-turn crash keeps the
				// call's outcome (the log then folds a complete assistant → tool_result pair)
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
				// Flush-before-next-step: this step's records are all on disk (the run failed before
				// turn_start, step stays 0 — no step marker was ever written). Notify the trajectory
				// only after persistence completes (fetches are always up to date, never half a turn).
				ctx.endTurn();
				// Only tool steps get nagged: a text-only step means the model already stopped (its final
				// text is delivered by enforceDelivery) — nagging it only begs "nothing in progress" replies.
				if (stepHadTool) notifyIfSilent();
				// Settle the sampling window (text-bearing steps only — tool-only steps have no speed to measure)
				runtime.runs += 1;
				if (firstDeltaAt > 0 && lastDeltaAt >= firstDeltaAt) {
					const ttft = firstDeltaAt - turnStartAt;
					const seconds = (lastDeltaAt - firstDeltaAt) / 1000;
					if (seconds > 0) {
						// pi maps the provider's completion_tokens to camelCase `output`
						const output = (event.message as AssistantMessage).usage?.output ?? 0;
						runtime.ttfts.push(ttft);
						runtime.lastTtft = ttft;
						runtime.speeds.push(output / seconds);
					}
				}
				// Persist the raw timing samples so TTFT/tok-s metrics survive restarts
				persistRuntime();
				{
					const persisted = step > 0 ? deps.session.appendStepEnd(runTurn, step, Date.now()).catch(logError) : Promise.resolve();
					return persisted.then(() => bridge.onTrajectoryUpdate());
				}
			case "agent_end":
				ctx.setRunning(false);
				enforceDelivery(event);
				// turn/end lands before onEnd so the settled state is already in the log when the view refetches
				return deps.session
					.appendTurnEnd(runTurn, agent.state.errorMessage ? "error" : "completed", Date.now())
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

	async function runPrompt(text: string) {
		// Opening reminder: the workflow plus the current workspace/storage paths (the prompt itself is static).
		// The default workspace path is included so the model can establish it without running pwd first.
		const opening =
			"Your workflow: (1) determine the task's working directory (see the `set_workspace` tool for what to pass); if the workspace is not set yet, call `set_workspace` with its absolute path as the first tool call, before other tools. (2) decide whether this task needs tool calls — if it does, call `send_message` in the same turn (in parallel with the first tool call) to give the user brief feedback; if it does not, skip the opening message. (3) Then execute the task.\n" +
			`Current workspace: ${ctx.workspace_path ?? "unset — the default working directory for tools is the storage path"}.\n` +
			`Current storage: ${ctx.storage_path ?? "unset"}.\n` +
			`Current sandbox mode: ${ctx.sandbox_mode}.`;
		persistReminder(opening);
		appendSystemReminder(agent.state.messages, opening);
		try {
			await agent.prompt(text);
		} catch (err) {
			// The only realistic throw is "Agent is already processing." —
			// a previous run is still settling (awaited agent_end listeners).
			// Queue it as a follow-up: the next run's drain point picks it up.
			agent.followUp({
				role: "user",
				content: text,
				timestamp: Date.now(),
			});
		}
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
		get runtimeStats(): SessionStats["runtime"] {
			const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
			return { runs: runtime.runs, avgTtftMs: avg(runtime.ttfts), avgTps: avg(runtime.speeds), lastTtftMs: runtime.lastTtft };
		},
		/** Resume a run from a restored context whose last message is a tool result (restart-resume after an approved escalation). */
		async continue() {
			if (ctx.running) return; // a run is already active — the resume is stale
			ctx.setRunning(true);
			try {
				await agent.continue();
			} catch (error) {
				// Only realistic throw: "Agent is already processing." — the run settled on its own
				ctx.setRunning(false);
				console.error("agent.continue failed:", error);
			}
		},
		async chat(text: string) {
			if (text.trim() === "") return;
			// Persist first (the view renders from persisted data, so it must be in the store before returning)
			await persistUser(text);
			ctx.markUserMessage();
			if (ctx.running) {
				// Outer loop: queue it; the loop drains follow-up messages
				// after the current turn settles.
				agent.followUp({
					role: "user",
					content: text,
					timestamp: Date.now(),
				});
				return;
			}
			ctx.setRunning(true);
			void runPrompt(text);
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
		// The prompt is static: paths arrive via system_reminder, so these do not rebuild it
		setStoragePath(path: string | null) {
			ctx.storage_path = path;
		},
		setWorkspace(path: string | null) {
			ctx.workspace_path = path;
			bridge.onWorkspaceUpdate();
		},
		previewSystemPrompt(partner: PartnerPrompt | null) {
			return ctx.previewSystemPrompt(partner);
		},
	};
}
