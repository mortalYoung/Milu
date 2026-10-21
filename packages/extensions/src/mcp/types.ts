export type McpLifecycle = "lazy" | "eager" | "keep-alive" | "lazy-keep-alive";

export interface McpStdioTransport {
	readonly type: "stdio";
	readonly command: string;
	readonly args?: string[];
	readonly env?: Record<string, string>;
	readonly cwd?: string;
}

export interface McpServerConfig {
	readonly name: string;
	readonly lifecycle?: McpLifecycle;
	readonly transport: McpStdioTransport;
}

export interface McpConfig {
	readonly servers: readonly McpServerConfig[];
	readonly idleTimeoutSec?: number;
	readonly defaultLifecycle?: McpLifecycle;
	readonly maxBufferSize?: number;
}

export interface McpToolSummary {
	readonly name: string;
	readonly description?: string;
}

export interface McpServerTools {
	readonly name: string;
	readonly tools: readonly McpToolSummary[];
	readonly error?: string;
}
