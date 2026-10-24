import { IConfigService, type ExecutionEnv, type Extension, ISettingsService, type ToolCall, type ToolResult, IToolService } from "@milu/core";

import { type McpParams, McpService, IMcpService, schema } from "./service/index.ts";

export { IMcpService } from "./service/index.ts";

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
