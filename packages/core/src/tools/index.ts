import type { AgentTool, ExecutionEnv } from "@earendil-works/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-agent-core";

import { bindEnv } from "./bind-env.ts";

export function createFileTools(env: ExecutionEnv): AgentTool[] {
	const context = { env };
	return [bindEnv(createReadTool(), context), bindEnv(createWriteTool(), context), bindEnv(createEditTool(), context)];
}
