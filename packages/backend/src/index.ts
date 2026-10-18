import { Container, type Disposable } from "@milu/di";

import { AgentLoopService, AgentLoopServiceId } from "./services/agent-loop.ts";
import { ConfigService, ConfigServiceId } from "./services/config.ts";
import { ContributionService, ContributionServiceId } from "./services/contributions.ts";
import { ModelsService, ModelsServiceId } from "./services/models.ts";
import { ToolService, ToolServiceId } from "./services/tools.ts";

export type { AgentLoopEvent, AgentLoopRun, AgentLoopService } from "./services/agent-loop.ts";
export type { ConfigService } from "./services/config.ts";
export { ContributionPoint, ContributionService } from "./services/contributions.ts";
export type { ModelRef, ModelsService } from "./services/models.ts";
export { ToolService } from "./services/tools.ts";
export { LocalExecutionEnv } from "./execution/local-env.ts";

export interface BackendConfig {
	root: string;
	workspace: string;
}

export interface Backend extends Disposable {
	readonly agentLoop: AgentLoopService;
	readonly models: ModelsService;
	readonly config: ConfigService;
	readonly contributions: ContributionService;
	readonly tools: ToolService;
}

export async function createBackend(config: BackendConfig): Promise<Backend> {
	const container = new Container();

	container.register(ConfigServiceId, () => new ConfigService({ root: config.root, workspace: config.workspace }));
	container.register(ContributionServiceId, () => new ContributionService());
	container.register(ModelsServiceId, (c) => new ModelsService(c.get(ConfigServiceId)));
	container.register(AgentLoopServiceId, (c) => new AgentLoopService(c.get(ModelsServiceId), c.get(ToolServiceId)));
	container.register(ToolServiceId, (c) => new ToolService(c.get(ConfigServiceId)));

	await container.initialize();

	const backend: Backend = {
		agentLoop: container.get(AgentLoopServiceId),
		models: container.get(ModelsServiceId),
		config: container.get(ConfigServiceId),
		contributions: container.get(ContributionServiceId),
		tools: container.get(ToolServiceId),
		dispose: () => container.dispose(),
	};

	return backend;
}
