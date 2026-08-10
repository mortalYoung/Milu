import {
	Agent,
	type AgentTool,
	type AgentEvent,
} from "@earendil-works/pi-agent-core";
import { createModels, Type } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

/**
 * The double-loop agent (pi-agent-core).
 *
 * - Inner loop: stream the LLM response, execute any tool calls, feed the
 *   results back to the model, repeat until the model stops.
 * - Outer loop: after a turn settles, drain queued steering / follow-up
 *   messages and keep running until nothing is left.
 *
 * Every user message becomes a `prompt()` run; messages sent while the agent
 * is streaming are queued via `followUp()` and picked up by the outer loop.
 */

export interface AgentBridge {
	/** Fired for every text delta of the current reply. */
	onDelta: (text: string) => void;
	/** A new turn began (one LLM call + tool executions). */
	onTurnStart: (turn: number) => void;
	/** A tool began/ended executing. */
	onTool: (name: string, status: "start" | "end") => void;
	/** The run settled. `error` is set on failure (e.g. missing API key). */
	onEnd: (error?: string) => void;
}

export interface AgentHandle {
	/** True while the agent is streaming or awaiting tool results. */
	readonly isStreaming: boolean;
	/** Send a user message. Queues as follow-up when the agent is busy. */
	chat: (text: string) => void;
	/** Abort the current run. */
	stop: () => void;
	/** Wipe the transcript. */
	reset: () => void;
}

const MODELS = createModels();
MODELS.setProvider(deepseekProvider());

const DEFAULT_MODEL = "deepseek-v4-flash";

// `now` — the one tool that makes the inner loop visible:
// the model calls it, the loop executes it, and the result
// is fed back into the next LLM call.
const nowTool = {
	name: "now",
	label: "Now",
	description:
		"Get the current date and time in the local timezone. Use it whenever you need to know what time it is.",
	parameters: Type.Object({}),
	async execute() {
		const iso = new Date().toISOString();
		return {
			content: [{ type: "text", text: iso }],
			details: { iso },
		};
	},
} satisfies AgentTool;

export function createAgent(bridge: AgentBridge): AgentHandle {
	const modelId = process.env["PI_MODEL"] ?? DEFAULT_MODEL;
	const model = MODELS.getModel("deepseek", modelId);
	if (!model) {
		throw new Error(
			`Model "${modelId}" not found for provider "deepseek". ` +
				"Set PI_MODEL to a model from the deepseek catalog (e.g. deepseek-v4-flash).",
		);
	}

	const agent = new Agent({
		initialState: {
			systemPrompt: [
				"CODING DESKTOP — a minimal agent harness.",
				"You answer tersely, in plain text, no markdown ceremony.",
				"If the user asks what time it is (or anything time-related), call the `now` tool.",
			].join("\n"),
			model,
			thinkingLevel: "off",
			tools: [nowTool],
		},
		streamFn: MODELS.streamSimple.bind(MODELS),
		// One queued message at a time, oldest first.
		followUpMode: "one-at-a-time",
		steeringMode: "one-at-a-time",
	});

	let turn = 0;
	let running = false;

	const handleEvent = (event: AgentEvent) => {
		switch (event.type) {
			case "turn_start":
				turn += 1;
				bridge.onTurnStart(turn);
				break;
			case "message_update":
				// Forward only the visible text deltas; thinking/toolcall
				// deltas stay internal to the loop.
				if (event.assistantMessageEvent.type === "text_delta") {
					bridge.onDelta(event.assistantMessageEvent.delta);
				}
				break;
			case "tool_execution_start":
				bridge.onTool(event.toolName, "start");
				break;
			case "tool_execution_end":
				bridge.onTool(event.toolName, "end");
				break;
			case "agent_end":
				running = false;
				bridge.onEnd(agent.state.errorMessage);
				break;
			default:
				break;
		}
	};

	agent.subscribe(handleEvent);

	async function runPrompt(text: string) {
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
		chat(text: string) {
			if (text.trim() === "") return;
			if (running) {
				// Outer loop: queue it; the loop drains follow-up messages
				// after the current turn settles.
				agent.followUp({
					role: "user",
					content: text,
					timestamp: Date.now(),
				});
				return;
			}
			running = true;
			void runPrompt(text);
		},
		stop() {
			agent.abort();
		},
		reset() {
			agent.reset();
			turn = 0;
			running = false;
		},
	};
}
