import type { AgentTool, AgentToolResult, ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { createServiceId, type Disposable, type Service } from "@milu/di";

import type { Session } from "../session/session.ts";
import type { ConfigService } from "./config.ts";
import type { ExecutionService } from "./execution.ts";
import { expandHome } from "./settings.ts";

export interface ToolCall {
	readonly session: Session;
	readonly workspace: string | null;
	readonly toolCallId: string;
	readonly name: string;
	readonly params: unknown;
	readonly signal?: AbortSignal;
}

export type ToolResult = AgentToolResult<any>;

export type ToolNext = (call: ToolCall, env: ExecutionEnv) => Promise<ToolResult>;

export type ToolMiddleware = (call: ToolCall, env: ExecutionEnv, next: ToolNext) => Promise<ToolResult>;

export interface Tool {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: TSchema;
	readonly executionMode?: "sequential" | "parallel";
	run(call: ToolCall, env: ExecutionEnv): Promise<ToolResult>;
}

export interface ToolFields {
	readonly tools: readonly string[];
	readonly properties: Record<string, TSchema>;
}

function extend(parameters: TSchema, fields: readonly ToolFields[], name: string): TSchema {
	const merged = fields.filter((entry) => entry.tools.includes(name)).reduce<Record<string, TSchema>>((all, entry) => ({ ...all, ...entry.properties }), {});
	if (Object.keys(merged).length === 0) return parameters;
	const object = parameters as { type?: string; properties?: Record<string, unknown> };
	if (object.type !== "object" || !object.properties) return parameters;
	return { ...object, properties: { ...object.properties, ...merged } } as TSchema;
}

export class ToolService implements Service {
	private readonly _tools: Tool[] = [];
	private readonly _middleware: ToolMiddleware[] = [];
	private readonly _fields: ToolFields[] = [];

	constructor(
		private readonly _configService: ConfigService,
		private readonly _executionService: ExecutionService,
	) {}

	register(tool: Tool): Disposable {
		if (this._tools.some((existing) => existing.name === tool.name)) throw new Error(`tool "${tool.name}" is already registered`);
		this._tools.push(tool);
		return {
			dispose: () => {
				const at = this._tools.indexOf(tool);
				if (at >= 0) this._tools.splice(at, 1);
			},
		};
	}

	use(middleware: ToolMiddleware): Disposable {
		this._middleware.push(middleware);
		return {
			dispose: () => {
				const at = this._middleware.indexOf(middleware);
				if (at >= 0) this._middleware.splice(at, 1);
			},
		};
	}

	extend(fields: ToolFields): Disposable {
		this._fields.push(fields);
		return {
			dispose: () => {
				const at = this._fields.indexOf(fields);
				if (at >= 0) this._fields.splice(at, 1);
			},
		};
	}

	async tools(session: Session): Promise<readonly AgentTool[]> {
		const workspace = await this._workspaceOf(session);
		return this._tools.map((tool) => ({
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: extend(tool.parameters, this._fields, tool.name),
			...(tool.executionMode === undefined ? {} : { executionMode: tool.executionMode }),
			execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => this._run({ session, workspace, toolCallId, name: tool.name, params, signal }),
		}));
	}

	async run(session: Session, call: { readonly toolCallId: string; readonly name: string; readonly params: unknown; readonly signal?: AbortSignal }): Promise<ToolResult> {
		return this._run({ session, workspace: await this._workspaceOf(session), ...call });
	}

	dispose(): void {
		this._tools.length = 0;
		this._middleware.length = 0;
		this._fields.length = 0;
	}

	private async _run(call: ToolCall): Promise<ToolResult> {
		const tool = this._tools.find((each) => each.name === call.name);
		if (!tool) throw new Error(`tool "${call.name}" is not registered`);

		const env = this._executionService.env(call.workspace ?? this._configService.workspace);
		const chain = this._middleware.reduceRight<ToolNext>(
			(next, middleware) => (inner, innerEnv) => middleware(inner, innerEnv, next),
			(inner, innerEnv) => tool.run(inner, innerEnv),
		);
		return chain(call, env);
	}

	private async _workspaceOf(session: Session): Promise<string | null> {
		const workspace = await session.workspace();
		return workspace ? expandHome(workspace.path) : null;
	}
}

export const ToolServiceId = createServiceId<ToolService>("ToolService");
