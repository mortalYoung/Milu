import { Agent, type AgentMessage, type AgentTool, type Message, type Model, type StreamFn } from "@milu/core";

export const REQUEST_TIMEOUT_MS = 60_000;
export const MEMORY_TEMPERATURE = 0.1;

export function createMemoryAgent(model: Model<any>, streamFn: StreamFn, systemPrompt: string, tools: readonly AgentTool[]): Agent {
	const greedy: StreamFn = (target, context, options) => streamFn(target, context, { ...options, temperature: MEMORY_TEMPERATURE, timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: 1 });
	const agent = new Agent({ streamFn: greedy, convertToLlm: toLlm, initialState: { systemPrompt } });
	agent.state.model = model;
	agent.state.tools = [...tools];
	return agent;
}

function toLlm(messages: readonly AgentMessage[]): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		if (message.role === "system" || message.role === "user" || message.role === "assistant" || message.role === "toolResult") out.push(message as Message);
	}
	return out;
}
