import type { Disposable } from "@milu/di";

import type { ChatScopeService } from "./services/chats.ts";
import type { ConfigService } from "./services/config.ts";
import type { ContributionService } from "./services/contributions.ts";
import type { ModelsService } from "./services/models.ts";
import type { SettingsService } from "./services/settings.ts";
import type { ToolService } from "./services/tools.ts";

export type { AgentLoopEvent, AgentLoopRun, AgentLoopService } from "./services/agent-loop.ts";
export { AgentLoopServiceId } from "./services/agent-loop.ts";
export type { ChatContext } from "./services/sessions.ts";
export { SessionServiceId } from "./services/sessions.ts";
export type { ChatEntry, ChatLoopEvent, ChatScope } from "./services/chats.ts";
export { ChatScopeService, ChatScopeServiceId } from "./services/chats.ts";
export { ConfigService, ConfigServiceId } from "./services/config.ts";
export { ContributionPoint, ContributionService, ContributionServiceId } from "./services/contributions.ts";
export { ExecutionService, ExecutionServiceId } from "./services/execution.ts";
export { ExtensionService, ExtensionServiceId } from "./services/extensions.ts";
export type { Extension, ExtensionContext } from "./extensions/types.ts";
export { sessionLogExtension } from "./extensions/session-log.ts";
export { ModelsService, ModelsServiceId, type ModelRef } from "./services/models.ts";
export { SessionService } from "./services/sessions.ts";
export { SettingsService, SettingsServiceId, type Settings } from "./services/settings.ts";
export { ToolService, ToolServiceId } from "./services/tools.ts";
export { LocalExecutionEnv } from "./execution/local-env.ts";

export interface BackendConfig {
	root: string;
	workspace: string;
}

/** What a shell gets from the core: the services, and one way to stop them. */
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
