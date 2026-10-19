import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createServiceId, type Service } from "@milu/di";

import { createFileTools } from "../tools/index.ts";
import type { ConfigService } from "./config.ts";
import type { ExecutionService } from "./execution.ts";

export class ToolService implements Service {
	private readonly _tools: AgentTool[];

	constructor(
		private readonly _configService: ConfigService,
		private readonly _executionService: ExecutionService,
	) {
		this._tools = createFileTools(this._executionService.env(this._configService.workspace));
	}

	tools(): readonly AgentTool[] {
		return this._tools;
	}

	dispose(): void {}
}

export const ToolServiceId = createServiceId<ToolService>("ToolService");
