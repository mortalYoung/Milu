import type { Disposable } from "@milu/di";

import type { ActionService } from "./services/actions.ts";
import type { CommandsService } from "./services/commands.ts";
import type { ConfigService } from "./services/config.ts";
import type { ContributionService } from "./services/contributions.ts";
import type { LayoutService } from "./services/layout.ts";
import type { ModelsService } from "./services/models.ts";
import type { SelectionService } from "./services/selection.ts";
import type { SessionService } from "./services/sessions.ts";
import type { SettingsService } from "./services/settings.ts";
import type { ToolService } from "./services/tools.ts";

export { Agent } from "@earendil-works/pi-agent-core";
export type { Entry, StreamFn } from "@earendil-works/pi-agent-core";
export type { Message, Model } from "@earendil-works/pi-ai";
export type { AgentLoopEvent, AgentLoopRun, AgentLoopService } from "./services/agent-loop.ts";
export { AgentLoopServiceId } from "./services/agent-loop.ts";
export { ActionService, ActionServiceId, type Action, type ActionContext } from "./services/actions.ts";
export { CommandsService, CommandsServiceId } from "./services/commands.ts";
export { CompactionService, CompactionServiceId, type CompactionContext, type CompactionPlanner } from "./services/compaction.ts";
export { ConfigService, ConfigServiceId } from "./services/config.ts";
export { ContributionPoint, ContributionService, ContributionServiceId, type ContributionScope } from "./services/contributions.ts";
export { ExecutionService, ExecutionServiceId } from "./services/execution.ts";
export { ExtensionService, ExtensionServiceId } from "./services/extensions.ts";
export { declareExtensionServices } from "./extensions/services.ts";
export { HookService, HookServiceId, type AgentHook, type AgentHookContext, type AgentHookPoint } from "./services/hooks.ts";
export { expandHome } from "./services/settings.ts";
export {
	COMPOSER_LEFT_POINT,
	COMPOSER_RIGHT_POINT,
	COMPOSER_TIPS_POINT,
	COMPOSER_COMMANDS_POINT,
	EXTENSION_API_VERSION,
	SESSION_HEADER_POINT,
	SESSION_MENU_POINT,
	CHAT_BAR_POINT,
	CHAT_NAME_POINT,
	CHAT_PANES_POINT,
	WELCOME_TIMELINE_POINT,
	SYSTEM_PROMPT_POINT,
	WELCOME_ITEMS_POINT,
	type ComposerCommand,
	type ComposerTipItem,
	type ComposerWidgetItem,
	type Extension,
	type ExtensionContext,
	type ExtensionServiceDeclaration,
	type PromptSection,
	type SessionHeaderItem,
	type SessionMenuItem,
	type SessionValue,
	type SlotItem,
	type WelcomeItem,
} from "./extensions/types.ts";
export { LayoutService, LayoutServiceId } from "./services/layout.ts";
export { ModelsService, ModelsServiceId, type ModelRef } from "./services/models.ts";
export { PromptService, PromptServiceId } from "./services/prompt.ts";
export { SelectionService, SelectionServiceId } from "./services/selection.ts";
export { SessionService, SessionServiceId, type SessionEntry, type SessionLoopEvent } from "./services/sessions.ts";
export { Session, type SessionDeps } from "./session/session.ts";
export { SessionLog } from "./session/log.ts";
export { projectSlice } from "./session/slice.ts";
export type { CompactionPlan, CompactionTier } from "./session/compact.ts";
export {
	contextChangedText,
	EVENTS,
	instructionsChangedText,
	mcpChangedText,
	reminderText,
	type AgentReminder,
	type ContextChangedData,
	type ReminderType,
} from "./session/events.ts";
export type { SessionModel, SessionProfile, WorkspaceFacts } from "./session/files.ts";
export { SettingsService, SettingsServiceId, type SandboxMode, type Settings, type SettingsPoint } from "./services/settings.ts";
export { ToolService, ToolServiceId, type Tool, type ToolCall, type ToolFields, type ToolMiddleware, type ToolNext, type ToolResult } from "./services/tools.ts";
export {
	bindEnv,
	withEnv,
	createEditTool,
	createReadTool,
	createWriteTool,
	err,
	ExecutionError,
	FileError,
	ok,
	Type,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
	type ExecutionEnv,
	type FileInfo,
	type FileKind,
	type Result,
	type Static,
	type TSchema,
} from "./tools/index.ts";
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
	readonly commands: CommandsService;
	readonly tools: ToolService;
	readonly settings: SettingsService;
	readonly layout: LayoutService;
	readonly selection: SelectionService;
	close(): Promise<void>;
}
