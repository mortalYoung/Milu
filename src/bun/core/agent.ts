/**
 * The double-loop agent runtime (pi-agent-core).
 * How the loop runs — not what the agent is (see agent-config.ts).
 *
 * - Inner loop: stream the LLM response, execute any tool calls, feed the
 *   results back to the model, repeat until the model stops.
 * - Outer loop: after a turn settles, drain queued steering / follow-up
 *   messages and keep running until nothing is left.
 *
 * Persistence: every turn is written to the session store (full process
 * data — thinking, tool calls, results). The user only sees `send_message`
 * output, delivered through the bridge's onMessage.
 */
import { statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionStats } from "../../shared/rpc";
import { createTools } from "../tools";
import { convertToLlm, resolveModel, STREAM_FN } from "./agent-config";
import { PROJECT_ROOT } from "./config";
import { AgentContext, appendSystemReminder } from "./context";
import type { PartnerPrompt } from "./prompt";
import type { SessionStore } from "./session";

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
	/** In-memory run timing (TTFT / tok/s), averaged across every streamed LLM call this process made. */
	readonly runtimeStats: SessionStats["runtime"];
	/** Send a user message (resolves after persistence); queued as a follow-up while busy. */
	chat: (text: string) => Promise<void>;
	/** Abort the current run. */
	stop: () => void;
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
	/** Conversation persistence store. */
	session: SessionStore;
	/** The initial message chain to restore (see toAgentMessages). */
	initialMessages?: AgentMessage[];
}

/** Whether a path is inside a root (or equal to it). */
function isInsideOf(target: string, root: string): boolean {
	return target === root || target.startsWith(root + sep);
}

/** Validate a set_workspace request: returns an error message, or null when the workspace is accepted. */
export function validateWorkspace(workspace: string, state: { current: string | null; storagePath: string | null }): string | null {
	if (state.current) return "Workspace can only be set once per conversation";
	if (!isAbsolute(workspace)) return "Workspace must be an absolute path";
	const abs = resolve(workspace);
	if (state.storagePath && isInsideOf(abs, state.storagePath)) return "Workspace cannot be inside the storage path";
	try {
		if (!statSync(abs).isDirectory()) return "Workspace path is not a directory";
	} catch {
		return "Workspace directory does not exist";
	}
	return null;
}

/**
 * Per-LLM-call timing samples: TTFT (turn start → first text delta) and output speed
 * (tokens per second between first and last delta). In-memory only — persisted usage
 * totals come from the session (see aggregateUsage).
 */
interface RuntimeStats {
	runs: number;
	ttfts: number[];
	speeds: number[];
	lastTtft: number | null;
}

export function createAgent(bridge: AgentBridge, deps: AgentDeps): AgentHandle {
	const ctx = new AgentContext();

	const runtime: RuntimeStats = { runs: 0, ttfts: [], speeds: [], lastTtft: null };
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

	// Tools need the agent instance (to write visible messages back into the agent context), so mount after construction;
	// after mounting, rebuild the system prompt so tool guidance is woven into the TOOL-GUIDANCE section.
	// The path guard reads the workspace/storage roots from the context (null = unset).
	agent.state.tools = createTools({
		store: deps.session,
		onVisibleMessage: (text, timestamp) => deliverVisible(text, timestamp),
		guard: {
			workspaceRoot: () => ctx.workspace_path,
			storageRoot: () => ctx.storage_path,
		},
		// set_workspace: once per conversation, absolute path, must exist, not inside storage
		onSetWorkspace: (workspace: string): string | null => {
			const error = validateWorkspace(workspace, { current: ctx.workspace_path, storagePath: ctx.storage_path });
			if (error) return error;
			const resolved = resolve(workspace);
			ctx.workspace_path = resolved;
			bridge.onWorkspaceUpdate();
			bridge.onWorkspaceSet?.(resolved);
			return null;
		},
	});
	ctx.setTools(agent.state.tools);
	agent.state.systemPrompt = ctx.composeSystemPrompt();

	/** Persist a reminder (custom entry) so the trajectory timeline shows it. */
	function persistReminder(text: string) {
		void deps.session.appendReminder(text, Date.now()).catch((error) => console.error("session appendReminder failed:", error));
	}

	/** 20s progress reminder: steering queues a message the outer loop always drains, driving a new turn — so even the final turn gets acted on. */
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
	 * Whether send_message was delivered within the last two turns — derived from the message chain
	 * (SSOT: every delivery is recorded there as a display:true custom message; each turn is one assistant
	 * message, so counting assistant messages since the last delivery ≈ counting turns).
	 * A real user message (not a <system_reminder> hint) resets the window: an answer to a new question
	 * must always be delivered, even if the previous turn delivered one.
	 */
	function recentMessage(): boolean {
		let assistants = 0;
		for (let i = agent.state.messages.length - 1; i >= 0; i--) {
			const m = agent.state.messages[i];
			if (m.role === "user" && !String(m.content).startsWith("<system_reminder>")) return false;
			if (m.role === "custom" && m.customType === "send_message") break;
			if (m.role === "assistant") assistants += 1;
		}
		return assistants < 2;
	}

	/**
	 * End-of-turn delivery: a text-only turn (no tool calls) means the model is answering — deliver that text
	 * directly via send_message instead of steering another turn. No extra LLM call, no loop risk.
	 * Skips when send_message was called within the last two turns (the user just got a message; a redundant
	 * commentary right after it should not produce another bubble).
	 */
	function enforceDelivery(event: Extract<AgentEvent, { type: "turn_end" }>) {
		if (recentMessage()) return;
		const assistant = event.message as AssistantMessage;
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") return;
		if (assistant.content.some((b) => b.type === "toolCall")) return; // still working mid-task
		const text = assistant.content
			.filter((b) => b.type === "text")
			.map((b) => (b.type === "text" ? b.text : ""))
			.join("\n")
			.trim();
		if (!text) return; // nothing to deliver
		deliverText(text);
	}

	const handleEvent = (event: AgentEvent) => {
		switch (event.type) {
			case "turn_start":
				bridge.onTurnStart(ctx.beginTurn());
				// Sampling window: the turn is one LLM call; its start is the closest event to the request being sent
				turnStartAt = performance.now();
				firstDeltaAt = 0;
				lastDeltaAt = 0;
				break;
			case "message_update":
				// First text token = TTFT; keep the last delta for the output speed window
				if (event.assistantMessageEvent.type === "text_delta") {
					if (firstDeltaAt === 0) firstDeltaAt = performance.now();
					lastDeltaAt = performance.now();
				}
				break;
			case "turn_end":
				// Notify the trajectory only after persistence completes (fetches are always up to date, never half a turn)
				void persistAssistantTurn(event).then(() => bridge.onTrajectoryUpdate());
				ctx.endTurn();
				notifyIfSilent();
				enforceDelivery(event);
				// Settle the sampling window (text-bearing turns only — tool-only turns have no speed to measure)
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
				break;
			case "agent_end":
				ctx.setRunning(false);
				bridge.onEnd(agent.state.errorMessage);
				break;
			default:
				break;
		}
	};

	function persistAssistantTurn(event: Extract<AgentEvent, { type: "turn_end" }>): Promise<void> {
		const assistant = event.message as AssistantMessage;
		return deps.session
			.appendAssistant(
				{
					blocks: assistant.content,
					toolResults: event.toolResults,
					usage: assistant.usage,
				},
				assistant.timestamp ?? Date.now(),
			)
			.catch((error) => console.error("session appendAssistant failed:", error));
	}

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
			"Your workflow: (1) determine the task's working directory — usually the project root of the code or project the user is asking about; if the workspace is not set yet, call `set_workspace` with its absolute path as the first tool call, before other tools. (2) decide whether this task needs tool calls — if it does, call `send_message` in the same turn (in parallel with the first tool call) to give the user brief feedback; if it does not, skip the opening message. (3) Then execute the task.\n" +
			`Current workspace: ${ctx.workspace_path ?? `unset (defaults to ${PROJECT_ROOT})`}.\n` +
			`Current storage: ${ctx.storage_path ?? "unset"}.`;
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
		get runtimeStats(): SessionStats["runtime"] {
			const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
			return { runs: runtime.runs, avgTtftMs: avg(runtime.ttfts), avgTps: avg(runtime.speeds), lastTtftMs: runtime.lastTtft };
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
