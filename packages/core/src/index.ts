import type { Disposable } from "@milu/di";

import type { ActionService } from "./services/actions.ts";
import type { ConfigService } from "./services/config.ts";
import type { ContributionService } from "./services/contributions.ts";
import type { LayoutService } from "./services/layout.ts";
import type { ModelsService } from "./services/models.ts";
import type { SessionService } from "./services/sessions.ts";
import type { SettingsService } from "./services/settings.ts";
import type { ToolService } from "./services/tools.ts";

export type { AgentLoopEvent, AgentLoopRun, AgentLoopService } from "./services/agent-loop.ts";
export { AgentLoopServiceId } from "./services/agent-loop.ts";
export { ActionService, ActionServiceId, type Action, type ActionContext } from "./services/actions.ts";
export { ConfigService, ConfigServiceId } from "./services/config.ts";
export { ContributionPoint, ContributionService, ContributionServiceId } from "./services/contributions.ts";
export { ExecutionService, ExecutionServiceId } from "./services/execution.ts";
export { ExtensionService, ExtensionServiceId } from "./services/extensions.ts";
export {
	COMPOSER_LEFT_POINT,
	COMPOSER_RIGHT_POINT,
	COMPOSER_TIPS_POINT,
	EXTENSION_API_VERSION,
	SESSION_HEADER_POINT,
	SESSION_MENU_POINT,
	SYSTEM_PROMPT_POINT,
	type ComposerTipItem,
	type ComposerWidgetItem,
	type Extension,
	type ExtensionContext,
	type PromptSection,
	type SessionHeaderItem,
	type SessionMenuItem,
	type SessionValue,
} from "./extensions/types.ts";
export { LayoutService, LayoutServiceId, type LayoutServiceDeps } from "./services/layout.ts";
export { ModelsService, ModelsServiceId, type ModelRef } from "./services/models.ts";
export { PromptService, PromptServiceId } from "./services/prompt.ts";
export { SessionService, SessionServiceId, type SessionEntry, type SessionLoopEvent } from "./services/sessions.ts";
export { Session, type SessionDeps } from "./session/session.ts";
export { SessionLog } from "./session/log.ts";
export type { SessionModel, SessionProfile, WorkspaceFacts } from "./session/files.ts";
export { SettingsService, SettingsServiceId, type Settings } from "./services/settings.ts";
export { ToolService, ToolServiceId } from "./services/tools.ts";
export { LocalExecutionEnv } from "./execution/local-env.ts";

export interface BackendConfig {
	root: string;
	workspace: string;
}

export interface Backend extends Disposable {
	readonly sessions: SessionService;
	readonly models: ModelsService;
	readonly config: ConfigService;
	readonly contributions: ContributionService;
	readonly actions: ActionService;
	readonly tools: ToolService;
	readonly settings: SettingsService;
	readonly layout: LayoutService;
	close(): Promise<void>;
}
