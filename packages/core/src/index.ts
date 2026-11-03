import type { Disposable } from "@milu/di";

import type { ActionService } from "./services/actions.ts";
import type { CommandsService } from "./services/commands.ts";
import type { ComposerService } from "./services/composer.ts";
import type { ConfigService } from "./services/config.ts";
import type { ContributionService } from "./services/contributions.ts";
import type { ExtensionService } from "./services/extensions.ts";
import type { LayoutService } from "./services/layout.ts";
import type { LifecycleService } from "./services/lifecycle.ts";
import type { ModelsService } from "./services/models.ts";
import type { SelectionService } from "./services/selection.ts";
import type { SessionService } from "./services/sessions.ts";
import type { SettingsService } from "./services/settings.ts";
import type { ToolService } from "./services/tools.ts";
import type { WatchService } from "./services/watch.ts";

export { Agent } from "@earendil-works/pi-agent-core";
export { isRetryableAssistantError } from "@earendil-works/pi-ai";
export type { Entry, StreamFn } from "@earendil-works/pi-agent-core";
export type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
export type { AgentLoopEvent, AgentLoopRun, AgentLoopService, PendingMessage } from "./services/agent-loop.ts";
export { IAgentLoopService } from "./services/agent-loop.ts";
export { ActionService, IActionService, type Action, type ActionContext, type ActionOutcome } from "./services/actions.ts";
export { CommandsService, ICommandsService } from "./services/commands.ts";
export { ComposerService, IComposerService, type ComposerModeChange } from "./services/composer.ts";
export { CompactionService, ICompactionService, type CompactionContext, type CompactionPlanner } from "./services/compaction.ts";
export { ConfigService, IConfigService } from "./services/config.ts";
export { ContributionPoint, ContributionService, IContributionService, type ContributionScope } from "./services/contributions.ts";
export { ExecutionService, IExecutionService } from "./services/execution.ts";
export { ExtensionService, IExtensionService } from "./services/extensions.ts";
export { declareExtensionServices } from "./extensions/services.ts";
export { diskSource } from "./extensions/disk-source.ts";
export type { HostHookPoint } from "./extensions/host.ts";
export { EXTENSION_API_VERSION, type ExtensionManifest, type ManifestWidget } from "./extensions/manifest.ts";
export type {
	ChildRequest,
	ChildResponse,
	ExtensionHost,
	ExtensionHostFactory,
	HostAction,
	HostRequest,
	HostResponse,
	HostSink,
	HostTool,
	HostToolCall,
	HostToolResult,
} from "./extensions/host.ts";
export { discoverExtensions, type DiscoveredExtensions, type ExtensionFailure, type ExtensionSource, type LocatedExtension, type WidgetRef } from "./extensions/source.ts";
export { HookService, IHookService, type AgentHook, type AgentHookContext, type AgentHookPoint } from "./services/hooks.ts";
export { expandHome } from "./services/settings.ts";
export {
	COMPOSER_LEFT_POINT,
	COMPOSER_RIGHT_POINT,
	COMPOSER_TIPS_POINT,
	COMPOSER_COMMANDS_POINT,
	SESSION_HEADER_POINT,
	SESSION_FOOTER_POINT,
	SESSION_MENU_POINT,
	SESSION_SIGNAL_POINT,
	CHAT_BAR_POINT,
	CHAT_NAME_POINT,
	CHAT_PANES_POINT,
	DOCK_BAR_POINT,
	COMPOSER_ABOVE_POINT,
	MESSAGE_META_POINT,
	WELCOME_TIMELINE_POINT,
	OVERLAY_POINT,
	SYSTEM_PROMPT_POINT,
	WELCOME_ITEMS_POINT,
	type ComposerCommand,
	type ComposerTipItem,
	type ComposerWidgetItem,
	type Extension,
	type ExtensionContext,
	type ExtensionServiceDeclaration,
	type PromptSection,
	type SessionBarItem,
	type SessionMenuItem,
	type SessionSignalItem,
	type SessionValue,
	type SlotItem,
	type WelcomeItem,
} from "./extensions/types.ts";
export { LayoutService, ILayoutService } from "./services/layout.ts";
export { WatchService, IWatchService } from "./services/watch.ts";
export { ILifecycleService, LifecycleService } from "./services/lifecycle.ts";
export { ModelsService, IModelsService, type ModelRef } from "./services/models.ts";
export { PromptService, IPromptService } from "./services/prompt.ts";
export { SelectionService, ISelectionService } from "./services/selection.ts";
export { SessionService, ISessionService, type SessionCompactingEvent, type SessionEntry, type SessionLoopEvent } from "./services/sessions.ts";
export { Session, type SessionDeps } from "./session/session.ts";
export { SessionLog } from "./session/log.ts";
export { pendingId, pendingView } from "./session/pending.ts";
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
export { SettingsService, ISettingsService, type CustomModel, type CustomProvider, type DefaultModel, type Settings, type SettingsPoint } from "./services/settings.ts";
export { ThemesService, IThemesService } from "./services/themes.ts";
export type { Theme, ThemeAppearance, ThemeMode, ThemeSettings, ThemeState, ThemeTokenKey, ThemeTokens } from "@milu/protocol";
export { ToolService, IToolService, type Tool, type ToolCall, type ToolFields, type ToolMiddleware, type ToolNext, type ToolResult } from "./services/tools.ts";
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
	hosts?: import("./extensions/host.ts").ExtensionHostFactory;
}

export interface Backend extends Disposable {
	readonly sessions: SessionService;
	readonly extensions: ExtensionService;
	readonly lifecycle: LifecycleService;
	readonly models: ModelsService;
	readonly config: ConfigService;
	readonly contributions: ContributionService;
	readonly actions: ActionService;
	readonly commands: CommandsService;
	readonly composer: ComposerService;
	readonly tools: ToolService;
	readonly settings: SettingsService;
	readonly layout: LayoutService;
	readonly selection: SelectionService;
	readonly watch: WatchService;
	close(): Promise<void>;
}
