import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_MCP_CONFIG_PATH, loadSettings, type Settings } from "../lib/settings";
import { BUILTIN_MCP_SERVERS, isBuiltinMcp } from "./builtin";
import type { McpConfig, McpLifecycle, McpServerConfig } from "./types";

const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LIFECYCLES: McpLifecycle[] = ["lazy", "eager", "keep-alive", "lazy-keep-alive"];

export function mcpConfigPath(settings: Pick<Settings, "mcp_config_path">): string {
	const configured = settings.mcp_config_path?.trim();
	const path = configured ? configured : DEFAULT_MCP_CONFIG_PATH;
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export function validateMcpServerName(name: string): string | null {
	if (!SERVER_NAME_RE.test(name)) return "Server name must be alphanumeric, with '_' or '-', max 64";
	return null;
}

export async function loadMcpConfig(): Promise<McpConfig> {
	try {
		const settings = await loadSettings();
		const parsed = JSON.parse(await readFile(mcpConfigPath(settings), "utf8")) as Partial<McpConfig>;
		const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
		return {
			servers: [...BUILTIN_MCP_SERVERS, ...servers.filter(isServerConfig).filter((server) => !isBuiltinMcp(server.name))],
			...(typeof parsed.idleTimeoutSec === "number" && Number.isFinite(parsed.idleTimeoutSec) ? { idleTimeoutSec: parsed.idleTimeoutSec } : {}),
			...(parsed.defaultLifecycle && LIFECYCLES.includes(parsed.defaultLifecycle) ? { defaultLifecycle: parsed.defaultLifecycle } : {}),
			...(typeof parsed.maxBufferSize === "number" && Number.isFinite(parsed.maxBufferSize) ? { maxBufferSize: parsed.maxBufferSize } : {}),
		};
	} catch {
		return { servers: [...BUILTIN_MCP_SERVERS] };
	}
}

export async function saveMcpConfig(config: McpConfig): Promise<void> {
	const settings = await loadSettings();
	const path = mcpConfigPath(settings);
	await mkdir(dirname(path), { recursive: true });
	const servers = config.servers.filter((server) => !isBuiltinMcp(server.name));
	await writeFile(path, JSON.stringify({ ...config, servers }, null, 2) + "\n", "utf8");
}

function isServerConfig(value: unknown): value is McpServerConfig {
	if (!value || typeof value !== "object") return false;
	const server = value as Partial<McpServerConfig>;
	if (typeof server.name !== "string") return false;
	if (server.lifecycle && !LIFECYCLES.includes(server.lifecycle)) return false;
	const transport = server.transport as McpServerConfig["transport"] | undefined;
	return transport?.type === "stdio" && typeof transport.command === "string" && transport.command.length > 0;
}
