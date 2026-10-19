import type { AgentHarnessTool, AgentTool, ExecutionToolContext } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";

export function bindEnv<TContext extends ExecutionToolContext, TParameters extends TSchema, TDetails>(
	tool: AgentHarnessTool<TContext, TParameters, TDetails>,
	context: TContext,
): AgentTool<TParameters, TDetails> {
	return {
		...tool,
		execute: (toolCallId, params, signal, onUpdate) => tool.execute(toolCallId, params, signal, onUpdate, context),
	};
}
