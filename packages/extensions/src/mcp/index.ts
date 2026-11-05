import {
	type AgentHookContext,
	EVENTS,
	type ExecutionEnv,
	type Extension,
	IConfigService,
	IHookService,
	ISessionService,
	ISettingsService,
	IToolService,
	type ToolCall,
	type ToolResult,
} from "@milu/core";

import { loadConfig, configPath } from "./config.ts";
import { grantedServers, setGrantedServer } from "./grants.ts";
import { type McpParams, McpService, IMcpService, schema } from "./service/index.ts";

export { IMcpService } from "./service/index.ts";

function recordedGrants(records: readonly { readonly entry: { readonly type: string; readonly data?: unknown } }[]): string[] {
	const last = records.at(-1)?.entry;
	if (last === undefined || last.type !== "custom") return [];
	const granted = (last.data as { granted?: unknown } | undefined)?.granted;
	return Array.isArray(granted) ? granted.filter((each): each is string => typeof each === "string") : [];
}

const mcpExtension: Extension = {
	id: "mcp",
	apiVersion: 1,

	services: [
		{
			id: IMcpService,
			create: (container) => new McpService(container.get(ISettingsService), container.get(IConfigService)),
		},
	],

	activate(context) {
		const mcp = context.get(IMcpService);
		const sessions = context.get(ISessionService);

		context.actions.register({
			id: "mcp.servers",
			run: async () => {
				const options = await mcp.options();
				const config = await loadConfig(configPath(options.configFile));
				const partners = await sessions.names();
				const grants = new Map<string, readonly string[]>();
				for (const partner of partners) grants.set(partner, await grantedServers(sessions.get(partner)));
				const statuses = new Map(mcp.allStatuses().map((status) => [status.name, status]));
				return {
					data: {
						partners,
						servers: config.servers.map((server) => {
							const status = statuses.get(server.name);
							return {
								name: server.name,
								lifecycle: server.lifecycle ?? config.defaultLifecycle ?? options.defaultLifecycle,
								state: status?.state ?? "stopped",
								toolCount: status?.toolCount ?? 0,
								...(status?.error === undefined ? {} : { error: status.error }),
								grantedPartners: partners.filter((partner) => grants.get(partner)?.includes(server.name) === true),
							};
						}),
					},
				};
			},
		});

		context.actions.register({
			id: "mcp.access",
			run: async ({ session }) => {
				if (!session) throw new Error("mcp.access needs a session");
				const options = await mcp.options();
				const config = await loadConfig(configPath(options.configFile));
				const granted = await grantedServers(session);
				const statuses = new Map(mcp.allStatuses().map((status) => [status.name, status]));
				const rows = config.servers.map((server) => {
					const status = statuses.get(server.name);
					return {
						group: "mcp",
						name: server.name,
						detail: status?.error ?? (status?.state === "connected" ? `${status.toolCount} tools` : undefined),
						meta: server.lifecycle ?? config.defaultLifecycle ?? options.defaultLifecycle,
						granted: granted.includes(server.name),
						alwaysOn: false,
					};
				});
				return { data: { rows } };
			},
		});

		context.actions.register({
			id: "mcp.grant",
			run: async ({ args }) => {
				const { name, partner, granted } = (args ?? {}) as { name?: unknown; partner?: unknown; granted?: unknown };
				if (typeof name !== "string" || name === "") throw new Error("mcp.grant needs a server name");
				if (typeof partner !== "string" || partner === "") throw new Error("mcp.grant needs a partner");
				if (typeof granted !== "boolean") throw new Error("mcp.grant needs granted to be true or false");
				await setGrantedServer(sessions.get(partner), name, granted);
			},
		});

		const announce = async ({ session, inject }: AgentHookContext): Promise<void> => {
			const current = await grantedServers(session);
			const known = recordedGrants(await session.records(EVENTS.mcpChanged));
			for (const server of current) if (!known.includes(server)) inject({ type: EVENTS.mcpChanged, data: { server, change: "added", granted: current } });
			for (const server of known) if (!current.includes(server)) inject({ type: EVENTS.mcpChanged, data: { server, change: "removed", granted: current } });
		};
		context.disposables.add(context.get(IHookService).on("beforeRequest", announce));

		context.disposables.add(
			context.get(IToolService).register({
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

export default mcpExtension;
