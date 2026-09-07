import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadMcpConfig } from "./config";
import type { McpConfig, McpLifecycle, McpServerConfig, McpServerStatus, McpServerStatusState } from "./types";

const DEFAULT_IDLE_TTL_MS = 60_000;
const DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;

interface McpSession {
	config: McpServerConfig;
	client: Client | null;
	transport: StdioClientTransport | null;
	tools: Tool[];
	state: McpServerStatusState;
	error?: string;
	idleTimer?: ReturnType<typeof setTimeout>;
}

export interface ResolvedMcpServer {
	name: string;
	tools: Tool[];
	error?: string;
}

export class McpManager {
	private config: McpConfig = { servers: [] };
	private sessions = new Map<string, McpSession>();
	private idleTimeoutMs = DEFAULT_IDLE_TTL_MS;
	private defaultLifecycle: McpLifecycle = "lazy";
	private maxBufferSize = DEFAULT_MAX_BUFFER_SIZE;

	async reload(): Promise<void> {
		await this.dispose();
		this.config = await loadMcpConfig();
		this.idleTimeoutMs = (this.config.idleTimeoutSec ?? DEFAULT_IDLE_TTL_MS / 1000) * 1000;
		this.defaultLifecycle = this.config.defaultLifecycle ?? "lazy";
		this.maxBufferSize = this.config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
		for (const server of this.config.servers) {
			this.sessions.set(server.name, this.newSession(server));
		}
		await this.startupEager();
	}

	async dispose(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.allSettled(sessions.map((session) => this.closeSession(session)));
	}

	listServers(): McpServerConfig[] {
		return this.config.servers;
	}

	statuses(): McpServerStatus[] {
		return this.config.servers.map((server) => {
			const session = this.sessions.get(server.name);
			return {
				name: server.name,
				lifecycle: session?.config.lifecycle ?? this.defaultLifecycle,
				state: session?.state ?? "stopped",
				toolCount: session?.tools.length ?? 0,
				...(session?.error ? { error: session.error } : {}),
			};
		});
	}

	async resolve(granted: string[]): Promise<ResolvedMcpServer[]> {
		const resolved: ResolvedMcpServer[] = [];
		for (const name of granted) {
			const session = this.sessions.get(name);
			if (!session) continue;
			try {
				const tools = await this.listTools(name);
				resolved.push({ name, tools });
			} catch (error) {
				resolved.push({ name, tools: [], error: error instanceof Error ? error.message : String(error) });
			}
		}
		return resolved;
	}

	async listTools(name: string): Promise<Tool[]> {
		const session = this.requireSession(name);
		await this.ensureStarted(name);
		if (session.tools.length === 0) {
			const result = await session.client!.listTools();
			session.tools = result.tools;
		}
		this.touch(session);
		return session.tools;
	}

	async callTool(name: string, toolName: string, args: unknown, signal?: AbortSignal): Promise<{ content: string; isError: boolean }> {
		const session = this.requireSession(name);
		await this.ensureStarted(name);
		const result = (await session.client!.callTool({ name: toolName, arguments: args as Record<string, unknown> }, undefined, signal ? { signal } : undefined)) as {
			content?: Array<{ text?: string; resource?: { text?: string } }>;
			isError?: boolean;
		};
		this.touch(session);
		const content = (result.content ?? [])
			.map((block) => {
				if ("text" in block && typeof block.text === "string") return block.text;
				if ("resource" in block && block.resource && typeof block.resource === "object" && "text" in block.resource) return String(block.resource.text);
				return JSON.stringify(block);
			})
			.join("\n");
		return { content, isError: result.isError === true };
	}

	private async startupEager(): Promise<void> {
		await Promise.allSettled(
			[...this.sessions.values()]
				.filter((session) => session.config.lifecycle === "eager" || session.config.lifecycle === "keep-alive")
				.map((session) => this.ensureStarted(session.config.name)),
		);
	}

	private newSession(config: McpServerConfig): McpSession {
		return { config, client: null, transport: null, tools: [], state: "stopped" };
	}

	private requireSession(name: string): McpSession {
		const session = this.sessions.get(name);
		if (!session) throw new Error(`MCP server "${name}" is not configured`);
		return session;
	}

	private async ensureStarted(name: string): Promise<void> {
		const session = this.requireSession(name);
		if (session.client && session.state === "connected") {
			this.touch(session);
			return;
		}
		if (session.state === "connecting") throw new Error(`MCP server "${name}" is still connecting`);
		session.state = "connecting";
		session.error = undefined;
		try {
			const client = new Client({ name: "letters", version: "0.1.0" });
			const transport = new StdioClientTransport({
				command: session.config.transport.command,
				...(session.config.transport.args ? { args: session.config.transport.args } : {}),
				...(session.config.transport.env ? { env: session.config.transport.env } : {}),
				...(session.config.transport.cwd ? { cwd: session.config.transport.cwd } : {}),
				maxBufferSize: this.maxBufferSize,
			});
			await client.connect(transport);
			session.client = client;
			session.transport = transport;
			session.state = "connected";
			this.touch(session);
		} catch (error) {
			session.state = "error";
			session.error = error instanceof Error ? error.message : String(error);
			await this.closeSession(session).catch(() => {});
			throw error;
		}
	}

	private touch(session: McpSession): void {
		if (session.idleTimer) clearTimeout(session.idleTimer);
		const lifecycle: McpLifecycle = session.config.lifecycle ?? this.defaultLifecycle;
		if (lifecycle === "lazy" || lifecycle === "eager") {
			session.idleTimer = setTimeout(() => void this.closeSession(session), this.idleTimeoutMs);
		}
	}

	private async closeSession(session: McpSession): Promise<void> {
		if (session.idleTimer) clearTimeout(session.idleTimer);
		session.idleTimer = undefined;
		const client = session.client;
		session.client = null;
		session.transport = null;
		session.tools = [];
		session.state = "stopped";
		session.error = undefined;
		if (client) await client.close().catch(() => {});
	}
}
