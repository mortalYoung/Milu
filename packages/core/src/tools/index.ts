export type { AgentHarnessTool, AgentMessage, AgentTool, AgentToolResult, ExecutionEnv, FileInfo, FileKind, Result } from "@earendil-works/pi-agent-core";
export { createEditTool, createReadTool, createWriteTool, err, ExecutionError, FileError, ok } from "@earendil-works/pi-agent-core";

import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";

import type { Tool } from "../services/tools.ts";
import { bindEnv } from "./bind-env.ts";

export { bindEnv } from "./bind-env.ts";

export { Type, type Static, type TSchema } from "@earendil-works/pi-ai";

export function withEnv(tool: AgentHarnessTool<any, any, any>): Tool {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		run: (call, env) => bindEnv(tool, { env }).execute(call.toolCallId, call.params, call.signal),
	};
}
