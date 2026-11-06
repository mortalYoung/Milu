import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { BrowserCommand, DialogDescriptor, Hotkey, Theme, WidgetType } from "@milu/protocol";
import type { TSchema } from "typebox";

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
export type { TSchema } from "typebox";

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

export type FileKind = "file" | "directory" | "symlink";

export interface FileInfo {
	readonly name: string;
	readonly path: string;
	readonly kind: FileKind;
	readonly size: number;
	readonly mtimeMs: number;
}

export type Result<TValue, TError> = { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: TError };

export type FileErrorCode = "aborted" | "not_found" | "permission_denied" | "not_directory" | "is_directory" | "invalid" | "not_supported" | "unknown";

export interface FileError extends Error {
	readonly code: FileErrorCode;
	readonly path?: string;
}

export type ExecutionErrorCode = "aborted" | "timeout" | "shell_unavailable" | "spawn_error" | "callback_error" | "unknown";

export interface ExecutionError extends Error {
	readonly code: ExecutionErrorCode;
}

export interface ShellExecOptions {
	readonly cwd?: string;
	readonly env?: Record<string, string>;
	readonly inheritEnv?: boolean;
	readonly timeout?: number;
	readonly abortSignal?: AbortSignal;
	readonly onStdout?: (chunk: string) => void;
	readonly onStderr?: (chunk: string) => void;
}

export interface FileSystem {
	readonly cwd: string;
	absolutePath(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
	joinPath(parts: string[], abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
	readTextFile(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
	readTextLines(path: string, options?: { readonly maxLines?: number; readonly abortSignal?: AbortSignal }): Promise<Result<string[], FileError>>;
	readBinaryFile(path: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>>;
	writeFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal): Promise<Result<void, FileError>>;
	appendFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal): Promise<Result<void, FileError>>;
	renameFile(sourcePath: string, destinationPath: string, abortSignal?: AbortSignal): Promise<Result<void, FileError>>;
	fileInfo(path: string, abortSignal?: AbortSignal): Promise<Result<FileInfo, FileError>>;
	listDir(path: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>>;
	canonicalPath(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
	exists(path: string, abortSignal?: AbortSignal): Promise<Result<boolean, FileError>>;
	createDir(path: string, options?: { readonly recursive?: boolean; readonly abortSignal?: AbortSignal }): Promise<Result<void, FileError>>;
	remove(path: string, options?: { readonly recursive?: boolean; readonly force?: boolean; readonly abortSignal?: AbortSignal }): Promise<Result<void, FileError>>;
	createTempDir(prefix?: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>>;
	createTempFile(options?: { readonly prefix?: string; readonly suffix?: string; readonly abortSignal?: AbortSignal }): Promise<Result<string, FileError>>;
}

export interface Shell {
	exec(command: string, options?: ShellExecOptions): Promise<Result<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }, ExecutionError>>;
	cleanup(): Promise<void>;
}

export interface ExecutionEnv extends FileSystem, Shell {}

export interface ExecutionToolContext {
	readonly env: ExecutionEnv;
}

type ToolParams<TParameters extends TSchema, TDetails> = Parameters<AgentTool<TParameters, TDetails>["execute"]>[1];

export type AgentHarnessTool<TContext extends object | undefined, TParameters extends TSchema = TSchema, TDetails = unknown> = Omit<AgentTool<TParameters, TDetails>, "execute"> & {
	execute(
		toolCallId: string,
		params: ToolParams<TParameters, TDetails>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		context: TContext,
	): Promise<AgentToolResult<TDetails>>;
};
