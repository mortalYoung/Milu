import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createServiceId, type Service } from "@milu/di";

import { LocalExecutionEnv } from "../execution/local-env.ts";
import { createFileTools } from "../tools/index.ts";
import type { ConfigService } from "./config.ts";

export class ToolService implements Service {
	private readonly _env: LocalExecutionEnv;
	private readonly _tools: AgentTool[];

	constructor(private readonly _configService: ConfigService) {
		this._env = new LocalExecutionEnv({ root: this._configService.workspace });
		this._tools = createFileTools(this._env);
	}

	tools(): readonly AgentTool[] {
		return this._tools;
	}

	dispose(): void {
		void this._env.cleanup();
	}
}

export const ToolServiceId = createServiceId<ToolService>("ToolService");
