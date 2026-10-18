import { Container, type Disposable } from "@milu/di";

import { sessionLogExtension } from "./extensions/session-log.ts";
import { ChatScopeService, ChatScopeServiceId } from "./services/chats.ts";
import { ConfigService, ConfigServiceId } from "./services/config.ts";
import { ContributionService, ContributionServiceId } from "./services/contributions.ts";
import { ExecutionService, ExecutionServiceId } from "./services/execution.ts";
import { ModelsService, ModelsServiceId } from "./services/models.ts";
import { SettingsService, SettingsServiceId } from "./services/settings.ts";
import { ToolService, ToolServiceId } from "./services/tools.ts";

export type { AgentLoopEvent, AgentLoopRun, AgentLoopService } from "./services/agent-loop.ts";
export type { ChatEntry, ChatLoopEvent, ChatScope } from "./services/chats.ts";
export type { ConfigService } from "./services/config.ts";
export { ContributionPoint, ContributionService } from "./services/contributions.ts";
export { ExtensionService } from "./services/extensions.ts";
export type { Extension, ExtensionContext } from "./extensions/types.ts";
export type { ModelRef, ModelsService } from "./services/models.ts";
export { ExecutionService } from "./services/execution.ts";
export { SessionService, type ChatContext } from "./services/sessions.ts";
export { SettingsService, type Settings } from "./services/settings.ts";
export { ToolService } from "./services/tools.ts";
export { LocalExecutionEnv } from "./execution/local-env.ts";

export interface BackendConfig {
	root: string;
	workspace: string;
}

export interface Backend extends Disposable {
	readonly chats: ChatScopeService;
	readonly models: ModelsService;
	readonly config: ConfigService;
	readonly contributions: ContributionService;
	readonly tools: ToolService;
	readonly settings: SettingsService;
	/** Graceful shutdown: stops accepting work, drains pending writes, then disposes. */
	close(): Promise<void>;
}

export async function createBackend(config: BackendConfig): Promise<Backend> {
	const container = new Container();

	container.register(ConfigServiceId, () => new ConfigService({ root: config.root, workspace: config.workspace }));
	container.register(ContributionServiceId, () => new ContributionService());
	container.register(ModelsServiceId, (c) => new ModelsService(c.get(ConfigServiceId)));
	container.register(ExecutionServiceId, () => new ExecutionService());
	container.register(SettingsServiceId, (c) => new SettingsService(c.get(ConfigServiceId)));
	container.register(ToolServiceId, (c) => new ToolService(c.get(ConfigServiceId), c.get(ExecutionServiceId)));
	container.register(ChatScopeServiceId, (c) => new ChatScopeService(c, c.get(SettingsServiceId), c.get(ExecutionServiceId), { extensions: [sessionLogExtension] }));

	await container.initialize();

	const chats = container.get(ChatScopeServiceId);

	return {
		chats,
		models: container.get(ModelsServiceId),
		config: container.get(ConfigServiceId),
		contributions: container.get(ContributionServiceId),
		tools: container.get(ToolServiceId),
		settings: container.get(SettingsServiceId),
		dispose: () => container.dispose(),
		async close() {
			// Dispose first so no chat keeps writing, then drain every chat's queue.
			container.dispose();
			await chats.flush();
		},
	};
}
