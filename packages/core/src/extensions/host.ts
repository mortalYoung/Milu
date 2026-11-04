import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { Theme } from "@milu/protocol";

import type { AgentHookPoint } from "../services/hooks.ts";
import type { AgentReminder } from "../session/events.ts";

export interface HostTool {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: TSchema;
}

export interface HostToolCall {
	readonly toolCallId: string;
	readonly name: string;
	readonly params: unknown;
	readonly workspace: string | null;
}

export interface HostToolResult {
	readonly content: unknown;
	readonly details: unknown;
}

export interface HostAction {
	readonly id: string;
	readonly scope?: string | readonly string[];
	readonly hotkey?: string | Readonly<Record<string, string>>;
}

export type HostHookPoint = AgentHookPoint;

export type HostRequest =
	| { readonly id: number; readonly method: "activate"; readonly params: { readonly entry: string; readonly extension: string } }
	| { readonly id: number; readonly method: "runTool"; readonly params: { readonly tool: string; readonly call: HostToolCall } }
	| { readonly id: number; readonly method: "runAction"; readonly params: { readonly action: string; readonly args?: unknown; readonly session: string | null } }
	| { readonly id: number; readonly method: "emitHook"; readonly params: { readonly point: AgentHookPoint; readonly messages: readonly AgentMessage[]; readonly session: string } }
	| { readonly id: number; readonly method: "settingsChanged"; readonly params: { readonly key: string; readonly value: unknown } }
	| { readonly id: number; readonly method: "contributionData"; readonly params: { readonly key: string; readonly session: string | null } }
	| { readonly id: number; readonly method: "callService"; readonly params: { readonly service: string; readonly method: string; readonly args: readonly unknown[] } }
	| { readonly id: number; readonly method: "dispose" };

export type ChildRequest =
	| { readonly id: number; readonly method: "registerTool"; readonly params: HostTool }
	| { readonly id: number; readonly method: "registerTheme"; readonly params: Theme }
	| { readonly id: number; readonly method: "registerAction"; readonly params: HostAction }
	| { readonly id: number; readonly method: "registerHook"; readonly params: { readonly point: AgentHookPoint } }
	| { readonly id: number; readonly method: "provideData"; readonly params: { readonly key: string } }
	| { readonly id: number; readonly method: "callService"; readonly params: { readonly service: string; readonly method: string; readonly args: readonly unknown[] } }
	| { readonly id: number; readonly method: "implementService"; readonly params: { readonly service: string; readonly methods: readonly string[] } }
	| { readonly id: number; readonly method: "settings"; readonly params: { readonly key: string; readonly defaults: unknown } };

export type HostResponse = { readonly id: number; readonly ok: true; readonly result: unknown } | { readonly id: number; readonly ok: false; readonly error: string };

export type ChildResponse = { readonly id: number; readonly ok: true; readonly result: unknown } | { readonly id: number; readonly ok: false; readonly error: string };

export interface HostSink {
	tool(tool: HostTool): void;
	theme(theme: Theme): void;
	settings(key: string, defaults: unknown): unknown;
	action(action: HostAction): void;
	hook(point: AgentHookPoint): void;
	data(key: string): void;
	service(service: string, methods: readonly string[]): void;
	call(service: string, method: string, args: readonly unknown[]): Promise<unknown>;
	exited(error: string): void;
}

export interface ExtensionHost {
	activate(entry: string): Promise<void>;
	runTool(tool: string, call: HostToolCall): Promise<HostToolResult>;
	runAction(action: string, params: { args?: unknown; session: string | null }): Promise<unknown>;
	emitHook(point: AgentHookPoint, params: { messages: readonly AgentMessage[]; session: string }): Promise<{ injected: readonly AgentReminder[] }>;
	notifySettings(key: string, value: unknown): void;
	contributionData(key: string, session: string | null): Promise<unknown>;
	callService(service: string, method: string, args: readonly unknown[]): Promise<unknown>;
	dispose(): void;
}

export interface ExtensionHostFactory {
	create(id: string, sink: HostSink): ExtensionHost;
}
