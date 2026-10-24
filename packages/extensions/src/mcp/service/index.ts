import { join } from "node:path";

import { ConfigService, type Session, type SettingsPoint, type SettingsService, Type } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { configPath, loadConfig } from "../config.ts";
import { grantedServers } from "../grants.ts";
import { McpManager } from "../manager.ts";
import type { McpServerStatus } from "../types.ts";

export const schema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("call")], { description: 'What to do: "list" the authorized servers and their tools, or "call" one tool.' }),
	server: Type.Optional(Type.String({ description: "call: MCP server name (from list)." })),
	tool: Type.Optional(Type.String({ description: "call: tool name on that server (from list)." })),
	arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "call: tool arguments." })),
});

export interface McpParams {
	op: "list" | "call";
	server?: string;
	tool?: string;
	arguments?: Record<string, unknown>;
}

export class McpService implements Service {
	private readonly _manager = new McpManager();
	private _config: SettingsPoint<string> | null = null;

	constructor(
		private readonly _settingsService: SettingsService,
		private readonly _configService: ConfigService,
	) {}

	async initialize(): Promise<void> {
		this._config = this._settingsService.declare({ key: "mcp_config_path", defaults: join(this._configService.root, "mcp.json") });
		await this._manager.load(await loadConfig(configPath(this._config.get())));
	}

	async list(session: Session): Promise<{ name: string; tools: { name: string; description?: string }[]; error?: string }[]> {
		return [...(await this._manager.resolve(await grantedServers(session)))].map((server) => ({
			name: server.name,
			tools: server.tools.map((tool) => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}) })),
			...(server.error ? { error: server.error } : {}),
		}));
	}

	async statuses(session: Session): Promise<McpServerStatus[]> {
		const byName = new Map(this._manager.statuses().map((status) => [status.name, status]));
		return (await grantedServers(session)).map((name) => {
			const status = byName.get(name);
			return {
				name,
				lifecycle: status?.lifecycle ?? "lazy",
				state: status?.state ?? "stopped",
				toolCount: status?.toolCount ?? 0,
				...(status?.error ? { error: status.error } : {}),
			};
		});
	}

	async call(session: Session, server: string, tool: string, args: unknown, signal?: AbortSignal): Promise<{ content: string; isError: boolean }> {
		const granted = await grantedServers(session);
		if (!granted.includes(server)) throw new Error(`MCP server "${server}" is not authorized for this session`);
		return this._manager.call(server, tool, args, signal);
	}

	dispose(): void {
		void this._manager.dispose();
	}
}

export const IMcpService = createServiceId<McpService>("mcp.servers");
