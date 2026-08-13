/**
 * What the agent IS: provider, model, stream function, context projection.
 * No loop mechanics here — `src/bun/core/agent.ts` only cares about the
 * double loop; tools live in `src/bun/tools/`.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels, type Message, type Model } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

const MODELS = createModels();
MODELS.setProvider(deepseekProvider());

const DEFAULT_MODEL = "deepseek-v4-flash";

/**
 * 把 agent 上下文投影为 provider 消息:
 * send_message 自定义消息(display:true)转成用户可见文本;其余自定义消息丢弃。
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.flatMap((m): Message[] => {
		if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
			return [m];
		}
		// 自定义消息:只投影 send_message 可见消息(带 display 字段),其余丢弃
		if ("display" in m && m.display) {
			return [{ role: "user", content: `[to user]: ${m.content}`, timestamp: m.timestamp }];
		}
		return [];
	});
}

export function resolveModel(): Model<any> {
	const modelId = process.env["PI_MODEL"] ?? DEFAULT_MODEL;
	const model = MODELS.getModel("deepseek", modelId);
	if (!model) {
		throw new Error(`Model "${modelId}" not found for provider "deepseek". ` + "Set PI_MODEL to a model from the deepseek catalog (e.g. deepseek-v4-flash).");
	}
	return model;
}

/** How the loop talks to the LLM. */
export const STREAM_FN = MODELS.streamSimple.bind(MODELS);
