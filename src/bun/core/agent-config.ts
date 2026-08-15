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
 * Project the agent context into provider messages:
 * - send_message custom messages (display:true) become user-visible text;
 * - system reminders ride as plain user messages (see appendSystemReminder);
 * - other custom messages are dropped.
 *
 * custom projections (user role) must not land between an assistant (tool_calls) and its tool results —
 * the OpenAI-compatible API requires tool messages to immediately follow their tool_calls' assistant;
 * a different-role message in between would 400. So custom projections are buffered first and
 * inserted before the next user/assistant.
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
	const out: Message[] = [];
	const pending: Message[] = [];
	const flush = () => {
		out.push(...pending);
		pending.length = 0;
	};
	for (const m of messages) {
		if (m.role === "user" || m.role === "assistant") {
			flush();
			out.push(m);
		} else if (m.role === "toolResult") {
			// Must stay adjacent to the assistant with its tool_calls; do not buffer
			out.push(m);
		} else if ("display" in m && m.display) {
			pending.push({ role: "user", content: `[to user]: ${m.content}`, timestamp: m.timestamp });
		}
	}
	flush();
	return out;
}

export function resolveModel(): Model<any> {
	const modelId = process.env["PI_MODEL"] ?? DEFAULT_MODEL;
	const model = MODELS.getModel("deepseek", modelId);
	if (!model) {
		throw new Error(`Model "${modelId}" not found for provider "deepseek". ` + "Set PI_MODEL to a model from the deepseek catalog (e.g. deepseek-v4-flash).");
	}
	return model;
}

/** Runtime info for the identify section: framework + current model (same source as resolveModel, follows PI_MODEL). */
export function describeRuntime(): { framework: string; model: string } {
	return { framework: "CODING DESKTOP", model: resolveModel().id };
}

/** How the loop talks to the LLM. */
export const STREAM_FN = MODELS.streamSimple.bind(MODELS);
