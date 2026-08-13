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
import { SYSTEM_PROMPT } from "./prompt";
import type { SessionStore } from "./session";

export interface AgentBridge {
	/** A new turn began (one LLM call + tool executions). */
	onTurnStart: (turn: number) => void;
	/** A visible message was sent to the user via send_message. */
	onMessage: (text: string) => void;
	/** The run settled. `error` is set on failure (e.g. missing API key). */
	onEnd: (error?: string) => void;
}

export interface AgentHandle {
	/** True while the agent is streaming or awaiting tool results. */
	readonly isStreaming: boolean;
	/** 发送用户消息(持久化完成后 resolve);忙时排队为 follow-up。 */
	chat: (text: string) => Promise<void>;
	/** Abort the current run. */
	stop: () => void;
	/** Wipe the transcript. */
	reset: () => void;
	/** 启动恢复:以持久化的消息链替换内存 transcript。 */
	restore: (messages: AgentMessage[]) => void;
}

export interface AgentDeps {
	/** 对话持久化存储。 */
	session: SessionStore;
	/** 恢复的初始消息链(见 toAgentMessages)。 */
	initialMessages?: AgentMessage[];
}

export function createAgent(bridge: AgentBridge, deps: AgentDeps): AgentHandle {
	const agent = new Agent({
		initialState: {
			systemPrompt: SYSTEM_PROMPT,
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

	// tools 需要 agent 实例(把可见消息写回 agent 上下文),故构造后再挂载
	agent.state.tools = createTools({
		store: deps.session,
		onVisibleMessage: (text, timestamp) => {
			agent.state.messages.push({
				role: "custom",
				customType: "send_message",
				content: text,
				display: true,
				timestamp,
			});
			bridge.onMessage(text);
		},
	});

	let turn = 0;
	let running = false;
	// 本轮运行内是否已产出过可见消息(用于防重复提示)
	let sentVisibleThisRun = false;
	// 连续未调用 send_message 的提示次数(上限防死循环)
	let nudgeCount = 0;

	/** 该回合若未调用 send_message,注入指令式提示让模型补答(每轮运行最多 3 次)。 */
	function nudgeIfForgotSendMessage(event: Extract<AgentEvent, { type: "turn_end" }>) {
		const assistant = event.message as AssistantMessage;
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") return;
		const calledSendMessage = assistant.content.some((b) => b.type === "toolCall" && b.name === "send_message");
		if (calledSendMessage) {
			sentVisibleThisRun = true;
			return;
		}
		if (sentVisibleThisRun || nudgeCount >= 3) return;
		nudgeCount += 1;
		// turn_end 订阅者先于 steering 轮询执行,此处 steer 下一回合必然被拾取
		agent.steer({
			role: "user",
			content: "<status_bar>Your reply was not delivered — plain text is never shown to the user. You MUST call the send_message tool now to send your reply.</status_bar>",
			timestamp: Date.now(),
		});
	}

	const handleEvent = (event: AgentEvent) => {
		switch (event.type) {
			case "agent_start":
				sentVisibleThisRun = false;
				nudgeCount = 0;
				break;
			case "turn_start":
				turn += 1;
				bridge.onTurnStart(turn);
				break;
			case "turn_end":
				// 全量持久化:assistant 消息(含 thinking/tool_use 块)+ 工具结果 + usage
				persistAssistantTurn(event);
				nudgeIfForgotSendMessage(event);
				break;
			case "agent_end":
				running = false;
				bridge.onEnd(agent.state.errorMessage);
				break;
			default:
				break;
		}
	};

	function persistAssistantTurn(event: Extract<AgentEvent, { type: "turn_end" }>) {
		const assistant = event.message as AssistantMessage;
		void deps.session
			.appendAssistant({ blocks: assistant.content, toolResults: event.toolResults, usage: assistant.usage }, assistant.timestamp ?? Date.now())
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
		async chat(text: string) {
			if (text.trim() === "") return;
			// 先落盘(视图按持久化数据渲染,须在返回前入库)
			await persistUser(text);
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
		restore(messages: AgentMessage[]) {
			agent.state.messages = messages;
		},
	};
}
