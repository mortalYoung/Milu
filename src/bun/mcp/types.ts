export type McpLifecycle = "lazy" | "eager" | "keep-alive" | "lazy-keep-alive";

export interface McpStdioTransport {
	type: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface McpServerConfig {
	name: string;
	lifecycle?: McpLifecycle;
	transport: McpStdioTransport;
}

export interface McpConfig {
	servers: McpServerConfig[];
	idleTimeoutSec?: number;
	defaultLifecycle?: McpLifecycle;
	maxBufferSize?: number;
}

export type McpServerStatusState = "stopped" | "connecting" | "connected" | "error";

export interface McpServerStatus {
	name: string;
	lifecycle: McpLifecycle;
	state: McpServerStatusState;
	toolCount: number;
	error?: string;
}
