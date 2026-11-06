export type { AgentMessage, AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
export type { ExecutionEnv, FileInfo, FileKind, Result } from "../execution/types.ts";
export { err, ExecutionError, FileError, getOrThrow, ok } from "./result.ts";
export { createEditTool } from "./edit.ts";
export { createReadTool } from "./read.ts";
export { createWriteTool } from "./write.ts";

import type { Tool } from "../services/tools.ts";
import { bindEnv } from "./bind-env.ts";
import type { AgentHarnessTool } from "./types.ts";

export { bindEnv } from "./bind-env.ts";

export { Type, type Static, type TSchema } from "typebox";

export function withEnv(tool: AgentHarnessTool<any, any, any>): Tool {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		run: (call, env) => bindEnv(tool, { env }).execute(call.toolCallId, call.params, call.signal),
	};
}
