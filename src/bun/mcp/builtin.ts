import type { McpServerConfig } from "./types";

export const BUILTIN_MCP_SERVERS: McpServerConfig[] = [
	{
		name: "chrome-devtools",
		lifecycle: "lazy",
		transport: { type: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp@1.10.1", "--autoConnect"] },
	},
];

export function isBuiltinMcp(name: string): boolean {
	return BUILTIN_MCP_SERVERS.some((server) => server.name === name);
}
