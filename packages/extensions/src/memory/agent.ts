import { Agent, type AgentMessage, type AgentTool, type Message, type Model, type StreamFn } from "@milu/core";

export function createMemoryAgent(model: Model<any>, streamFn: StreamFn, systemPrompt: string, tools: readonly AgentTool[]): Agent {
	const agent = new Agent({ streamFn, convertToLlm: toLlm, initialState: { systemPrompt } });
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
