import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

import type { AgentHarnessTool, ExecutionToolContext } from "./types.ts";

export function bindEnv<TContext extends ExecutionToolContext, TParameters extends TSchema, TDetails>(
	tool: AgentHarnessTool<TContext, TParameters, TDetails>,
	context: TContext,
): AgentTool<TParameters, TDetails> {
	return {
		...tool,
		execute: (toolCallId, params, signal, onUpdate) => tool.execute(toolCallId, params, signal, onUpdate, context),
	};
}
