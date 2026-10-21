import { join } from "node:path";

import {
	ConfigService,
	ConfigServiceId,
	type ExecutionEnv,
	type Extension,
	type Session,
	type SettingsPoint,
	type SettingsService,
	SettingsServiceId,
	type ToolCall,
	type ToolResult,
	ToolServiceId,
	Type,
} from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { configPath, loadConfig } from "./config.ts";
import { grantedServers } from "./grants.ts";
import { McpManager } from "./manager.ts";

const schema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("call")], { description: 'What to do: "list" the authorized servers and their tools, or "call" one tool.' }),
	server: Type.Optional(Type.String({ description: "call: MCP server name (from list)." })),
	tool: Type.Optional(Type.String({ description: "call: tool name on that server (from list)." })),
	arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "call: tool arguments." })),
});

interface McpParams {
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

	async call(session: Session, server: string, tool: string, args: unknown, signal?: AbortSignal): Promise<{ content: string; isError: boolean }> {
		const granted = await grantedServers(session);
		if (!granted.includes(server)) throw new Error(`MCP server "${server}" is not authorized for this session`);
		return this._manager.call(server, tool, args, signal);
	}

	dispose(): void {
		void this._manager.dispose();
	}
}

export const McpServiceId = createServiceId<McpService>("mcp.servers");

export const mcpExtension: Extension = {
	id: "mcp",
	apiVersion: 1,

	services: [
		{
			id: McpServiceId,
			create: (container) => new McpService(container.get(SettingsServiceId), container.get(ConfigServiceId)),
		},
	],

	activate(context) {
		const mcp = context.get(McpServiceId);

		context.disposables.add(
			context.get(ToolServiceId).register({
				name: "mcp",
				label: "MCP",
				description:
					"Work with MCP servers authorized for this session. `list` shows each server with the tools it exposes; `call` runs one tool on one server. Run `list` first to discover names.",
				parameters: schema,
				async run(call: ToolCall, _env: ExecutionEnv) {
					const { op, server, tool, arguments: args } = call.params as McpParams;

					if (op === "list") {
						const servers = await mcp.list(call.session);
						if (servers.length === 0) return text("No MCP servers are authorized for this session.");
						const body = servers
							.map((each) => {
								const head = `## ${each.name}`;
								if (each.error) return `${head}\n  error: ${each.error}`;
								if (each.tools.length === 0) return `${head}\n  (no tools)`;
								return `${head}\n${each.tools.map((entry) => `- ${entry.name}${entry.description ? `: ${entry.description}` : ""}`).join("\n")}`;
							})
							.join("\n\n");
						return text(body);
					}

					if (!server || !tool) return text('mcp call needs both "server" and "tool".');
					try {
						const result = await mcp.call(call.session, server, tool, args, call.signal);
						return { content: [{ type: "text", text: result.content || "(no output)" }], details: { ok: !result.isError, isError: result.isError } };
					} catch (error) {
						return text(`mcp call failed: ${error instanceof Error ? error.message : String(error)}`, { ok: false, isError: true });
					}
				},
			}),
		);
	},
};

function text(value: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text", text: value }], details };
}
