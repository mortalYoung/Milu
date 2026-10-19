import type { Disposable } from "@milu/di";

import type { ConfigService } from "./services/config.ts";
import type { ContributionService } from "./services/contributions.ts";
import type { LayoutService } from "./services/layout.ts";
import type { ModelsService } from "./services/models.ts";
import type { SessionService } from "./services/sessions.ts";
import type { SettingsService } from "./services/settings.ts";
import type { ToolService } from "./services/tools.ts";

export type { AgentLoopEvent, AgentLoopRun, AgentLoopService } from "./services/agent-loop.ts";
export { AgentLoopServiceId } from "./services/agent-loop.ts";
export { ConfigService, ConfigServiceId } from "./services/config.ts";
export { ContributionPoint, ContributionService, ContributionServiceId } from "./services/contributions.ts";
export { ExecutionService, ExecutionServiceId } from "./services/execution.ts";
export { ExtensionService, ExtensionServiceId } from "./services/extensions.ts";
export type { Extension, ExtensionContext } from "./extensions/types.ts";
export { LayoutService, LayoutServiceId, type LayoutServiceDeps } from "./services/layout.ts";
export { ModelsService, ModelsServiceId, type ModelRef } from "./services/models.ts";
export { SessionService, SessionServiceId, type SessionEntry, type SessionLoopEvent } from "./services/sessions.ts";
export { Session, type SessionDeps } from "./session/session.ts";
export { SessionLog } from "./session/log.ts";
export type { SessionProfile, WorkspaceFacts } from "./session/files.ts";
export { SettingsService, SettingsServiceId, type Settings } from "./services/settings.ts";
export { ToolService, ToolServiceId } from "./services/tools.ts";
export { LocalExecutionEnv } from "./execution/local-env.ts";
export {
	editorNames,
	FOLDER_BROWSER_AVAILABLE,
	listInstalledEditors,
	openInCodeEditor,
	openInFinder,
	openTargets,
	type EditorInfo,
	type EditorTarget,
	type OpenOutcome,
	type OpenTargets,
} from "./system/openers.ts";

export interface BackendConfig {
	root: string;
	workspace: string;
}

/** What a shell gets from the core: the services, and one way to stop them. */
export interface Backend extends Disposable {
	readonly sessions: SessionService;
	readonly models: ModelsService;
	readonly config: ConfigService;
	readonly contributions: ContributionService;
	readonly tools: ToolService;
	readonly settings: SettingsService;
	/** What the page can hold, and where each piece sits. */
	readonly layout: LayoutService;
	/** Graceful shutdown: stops accepting work, drains pending writes, then disposes. */
	close(): Promise<void>;
}
