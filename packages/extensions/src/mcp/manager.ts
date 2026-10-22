import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { McpConfig, McpLifecycle, McpServerConfig, McpServerStatus, McpServerTools, McpToolSummary } from "./types.ts";

const DEFAULT_IDLE_TTL_MS = 60_000;
const DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;

const FALLBACK_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", ".bun/bin", ".local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

const run = promisify(execFile);

function withFallbackPath(inherited: string, home: string): string {
	const dirs = [...inherited.split(":"), ...FALLBACK_BIN_DIRS.map((dir) => (dir.startsWith("/") ? dir : join(home, dir)))].filter(Boolean);
	return [...new Set(dirs)].join(":");
}

let shellPathPromise: Promise<string> | null = null;

function safeCwd(home: string): string {
	try {
		return process.cwd();
	} catch {
		return home;
	}
}

async function shellPath(): Promise<string> {
	shellPathPromise ??= (async () => {
		try {
			const { stdout } = await run(process.env["SHELL"]?.trim() || "/bin/zsh", ["-lc", 'printf %s "$PATH"'], { cwd: safeCwd(homedir()), timeout: 5000 });
			if (stdout.includes("/")) return withFallbackPath(`${stdout}:${process.env["PATH"] ?? ""}`, homedir());
		} catch {}
		return withFallbackPath(process.env["PATH"] ?? "", homedir());
	})();
	return shellPathPromise;
}

interface Session {
	readonly config: McpServerConfig;
	client: Client | null;
	tools: McpToolSummary[];
	state: "stopped" | "connecting" | "connected" | "error";
	error?: string;
	idleTimer?: ReturnType<typeof setTimeout>;
}

export class McpManager {
	private _sessions = new Map<string, Session>();
	private _idleTimeoutMs = DEFAULT_IDLE_TTL_MS;
	private _defaultLifecycle: McpLifecycle = "lazy";
	private _maxBufferSize = DEFAULT_MAX_BUFFER_SIZE;

	async load(config: McpConfig): Promise<void> {
		await this.dispose();
		this._idleTimeoutMs = (config.idleTimeoutSec ?? DEFAULT_IDLE_TTL_MS / 1000) * 1000;
		this._defaultLifecycle = config.defaultLifecycle ?? "lazy";
		this._maxBufferSize = config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
		for (const server of config.servers) this._sessions.set(server.name, { config: server, client: null, tools: [], state: "stopped" });

		await Promise.allSettled(
			[...this._sessions.values()]
				.filter((session) => session.config.lifecycle === "eager" || session.config.lifecycle === "keep-alive")
				.map((session) => this._started(session.config.name)),
		);
	}

	async tools(name: string): Promise<readonly McpToolSummary[]> {
		const session = this._session(name);
		await this._started(name);
		if (session.tools.length === 0) {
			const listed = await session.client!.listTools();
			session.tools = listed.tools.map((tool) => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}) }));
		}
		this._touch(session);
		return session.tools;
	}

	statuses(): McpServerStatus[] {
		return [...this._sessions.values()].map((session) => ({
			name: session.config.name,
			lifecycle: session.config.lifecycle ?? this._defaultLifecycle,
			state: session.state,
			toolCount: session.tools.length,
			...(session.error ? { error: session.error } : {}),
		}));
	}

	async resolve(granted: readonly string[]): Promise<readonly McpServerTools[]> {
		const resolved: McpServerTools[] = [];
		for (const name of granted) {
			if (!this._sessions.has(name)) continue;
			try {
				resolved.push({ name, tools: await this.tools(name) });
			} catch (error) {
				resolved.push({ name, tools: [], error: error instanceof Error ? error.message : String(error) });
			}
		}
		return resolved;
	}

	async call(name: string, tool: string, args: unknown, signal?: AbortSignal): Promise<{ content: string; isError: boolean }> {
		const session = this._session(name);
		await this._started(name);
		const result = (await session.client!.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> }, undefined, signal ? { signal } : {})) as {
			content?: Array<{ text?: string; resource?: { text?: string } }>;
			isError?: boolean;
		};
		this._touch(session);

		const content = (result.content ?? [])
			.map((block) => {
				if ("text" in block && typeof block.text === "string") return block.text;
				if ("resource" in block && block.resource && typeof block.resource === "object" && "text" in block.resource) return String(block.resource.text);
				return JSON.stringify(block);
			})
			.join("\n");
		return { content, isError: result.isError === true };
	}

	async dispose(): Promise<void> {
		const sessions = [...this._sessions.values()];
		this._sessions.clear();
		await Promise.allSettled(sessions.map((session) => this._close(session)));
	}

	private _session(name: string): Session {
		const session = this._sessions.get(name);
		if (!session) throw new Error(`MCP server "${name}" is not configured`);
		return session;
	}

	private async _started(name: string): Promise<void> {
		const session = this._session(name);
		if (session.client && session.state === "connected") {
			this._touch(session);
			return;
		}
		if (session.state === "connecting") throw new Error(`MCP server "${name}" is still connecting`);

		session.state = "connecting";
		session.error = undefined;
		try {
			const client = new Client({ name: "milu", version: "0.1.0" });
			const transport = new StdioClientTransport({
				command: session.config.transport.command,
				...(session.config.transport.args ? { args: session.config.transport.args } : {}),
				env: { PATH: await shellPath(), ...session.config.transport.env },
				cwd: session.config.transport.cwd ?? safeCwd(homedir()),
				maxBufferSize: this._maxBufferSize,
			});
			await client.connect(transport);
			session.client = client;
			session.state = "connected";
			this._touch(session);
		} catch (error) {
			session.state = "error";
			session.error = error instanceof Error ? error.message : String(error);
			await this._close(session).catch(() => {});
			throw error;
		}
	}

	private _touch(session: Session): void {
		if (session.idleTimer) clearTimeout(session.idleTimer);
		const lifecycle = session.config.lifecycle ?? this._defaultLifecycle;
		if (lifecycle === "lazy" || lifecycle === "eager") session.idleTimer = setTimeout(() => void this._close(session), this._idleTimeoutMs);
	}

	private async _close(session: Session): Promise<void> {
		if (session.idleTimer) clearTimeout(session.idleTimer);
		session.idleTimer = undefined;
		const client = session.client;
		session.client = null;
		session.tools = [];
		session.state = "stopped";
		session.error = undefined;
		if (client) await client.close().catch(() => {});
	}
}
