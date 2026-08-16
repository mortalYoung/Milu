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
import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createTools } from "../tools";
import { convertToLlm, resolveModel, STREAM_FN } from "./agent-config";
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
	/** The run settled. `error` is set on failure (e.g. missing API key). */
	onEnd: (error?: string) => void;
}

export interface AgentHandle {
	/** True while the agent is streaming or awaiting tool results. */
	readonly isStreaming: boolean;
	/** The current system prompt (rebuilt on setPartner/setStoragePath). */
	readonly systemPrompt: string;
	/** Send a user message (resolves after persistence); queued as a follow-up while busy. */
	chat: (text: string) => Promise<void>;
	/** Abort the current run. */
	stop: () => void;
	/** Wipe the transcript. */
	reset: () => void;
	/** Startup restore: replace the in-memory transcript with the persisted message chain. */
	restore: (messages: AgentMessage[]) => void;
	/** Switch Partner: rebuild the system prompt from the profile fields (role/responsibilities/tones). */
	setPartner: (partner: PartnerPrompt | null) => void;
	/** Set the agent's storage directory (written into the prompt as the STORAGE section); null clears it. */
	setStoragePath: (path: string | null) => void;
	/** Compose a trial four-section system prompt from the profile fields (for preview; does not change agent state). */
	previewSystemPrompt: (partner: PartnerPrompt | null) => string;
}

export interface AgentDeps {
	/** Conversation persistence store. */
	session: SessionStore;
	/** The initial message chain to restore (see toAgentMessages). */
	initialMessages?: AgentMessage[];
}

export function createAgent(bridge: AgentBridge, deps: AgentDeps): AgentHandle {
	const ctx = new AgentContext();

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
	// after mounting, rebuild the system prompt so tool guidance is woven into the TOOL-GUIDANCE section
	agent.state.tools = createTools({
		store: deps.session,
		onVisibleMessage: (text, timestamp) => deliverVisible(text, timestamp),
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
				break;
			case "turn_end":
				// Notify the trajectory only after persistence completes (fetches are always up to date, never half a turn)
				void persistAssistantTurn(event).then(() => bridge.onTrajectoryUpdate());
				ctx.endTurn();
				notifyIfSilent();
				enforceDelivery(event);
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
		// Opening reminder: always open with a brief send_message feedback before starting, regardless of
		// task size. Progress (every ~20s) and final delivery are handled by notifyIfSilent and enforceDelivery.
		const opening = "Before starting, call `send_message` first to give the user a brief feedback about what you're about to do, regardless of the task size.";
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
		setStoragePath(path: string | null) {
			ctx.storage_path = path;
			agent.state.systemPrompt = ctx.composeSystemPrompt();
		},
		previewSystemPrompt(partner: PartnerPrompt | null) {
			return ctx.previewSystemPrompt(partner);
		},
	};
}
