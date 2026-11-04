import type { AgentToolResult, ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { BrowserCommand, DialogDescriptor, Hotkey, Theme, WidgetType } from "@milu/protocol";

export type {
	BrowserCommand,
	ComposerCommand,
	ComposerTip,
	DialogDescriptor,
	Hotkey,
	SlotItem,
	Theme,
	ThemeAppearance,
	ThemeMode,
	ThemeSettings,
	ThemeTokenKey,
	ThemeTokens,
	WelcomeItem,
	WidgetType,
} from "@milu/protocol";
export type { ExecutionEnv } from "@earendil-works/pi-agent-core";
export type { TSchema } from "@earendil-works/pi-ai";

export interface Disposable {
	dispose(): void;
}

export interface Disposables {
	add<T extends Disposable>(disposable: T): T;
}

export interface SettingsPoint<T> {
	get(): T;
}

export interface SettingsPort {
	declare<T>(section: { readonly key: string; readonly defaults: T }): SettingsPoint<T>;
}

export interface ThemesPort {
	register(theme: Theme): Disposable;
}

export interface ToolCall {
	readonly toolCallId: string;
	readonly name: string;
	readonly params: unknown;
	readonly workspace?: string | null;
	readonly signal?: AbortSignal;
}

export type ToolResult = AgentToolResult<unknown>;

export interface Tool {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: TSchema;
	readonly executionMode?: "sequential" | "parallel";
	run(call: ToolCall, env: ExecutionEnv): Promise<ToolResult>;
}

export interface ToolsPort {
	register(tool: Tool): Disposable;
}

export interface ActionContext {
	readonly args?: unknown;
	readonly dialog?: (dialog: DialogDescriptor) => Promise<unknown>;
}

export type ActionOutcome = void | BrowserCommand | { readonly data: unknown };

export interface Action {
	readonly id: string;
	readonly scope?: string | readonly string[];
	readonly hotkey?: Hotkey;
	run(context: ActionContext): ActionOutcome | Promise<ActionOutcome>;
}

export interface ActionsPort {
	register(action: Action): Disposable;
}

export interface ModelsPort {
	resolve(ref?: { readonly provider: string; readonly modelId?: string }): unknown;
}

export interface ConfigPort {
	readonly root: string;
	readonly workspace: string;
}

export interface ExtensionWidget {
	readonly id: string;
	readonly type: WidgetType;
	readonly entry: string;
	readonly export?: string;
}

export interface ExtensionContainer {
	get(id: { readonly name: string }): unknown;
}

export interface ExtensionServiceDeclaration {
	readonly id: { readonly name: string };
	create(container: ExtensionContainer): unknown;
}

export interface ExtensionContext {
	readonly id: string;
	readonly disposables: Disposables;
	readonly settings: SettingsPort;
	readonly themes: ThemesPort;
	readonly actions: ActionsPort;
	readonly models: ModelsPort;
	readonly tools: ToolsPort;
	readonly config: ConfigPort;
}

export interface Extension {
	readonly id: string;
	readonly apiVersion?: number;
	readonly services?: readonly ExtensionServiceDeclaration[];
	readonly contributions?: { readonly [point: string]: readonly unknown[] | undefined };
	activate?(context: ExtensionContext): void | Promise<void>;
}
