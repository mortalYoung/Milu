import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { McpConfig, McpLifecycle, McpServerConfig } from "./types.ts";

const LIFECYCLES: readonly McpLifecycle[] = ["lazy", "eager", "keep-alive", "lazy-keep-alive"];

export const BUILTIN_SERVERS: readonly McpServerConfig[] = [
	{
		name: "chrome-devtools",
		lifecycle: "lazy",
		transport: { type: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp@1.10.1", "--autoConnect"] },
	},
];

function expandHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export function configPath(configured: string | undefined): string {
	return expandHome(configured?.trim() || join(homedir(), ".milu", "mcp.json"));
}

function isServer(value: unknown): value is McpServerConfig {
	if (!value || typeof value !== "object") return false;
	const server = value as Partial<McpServerConfig>;
	if (typeof server.name !== "string") return false;
	if (server.lifecycle && !LIFECYCLES.includes(server.lifecycle)) return false;
	const transport = server.transport as McpServerConfig["transport"] | undefined;
	return transport?.type === "stdio" && typeof transport.command === "string" && transport.command.length > 0;
}

export async function loadConfig(path: string): Promise<McpConfig> {
	const text = await readFile(path, "utf8").catch(() => null);
	if (text === null) return { servers: [...BUILTIN_SERVERS] };

	let parsed: Partial<McpConfig>;
	try {
		parsed = JSON.parse(text) as Partial<McpConfig>;
	} catch {
		return { servers: [...BUILTIN_SERVERS] };
	}

	const configured = Array.isArray(parsed.servers) ? parsed.servers.filter(isServer) : [];
	const builtin = new Set(BUILTIN_SERVERS.map((server) => server.name));
	return {
		servers: [...BUILTIN_SERVERS, ...configured.filter((server) => !builtin.has(server.name))],
		...(typeof parsed.idleTimeoutSec === "number" && Number.isFinite(parsed.idleTimeoutSec) ? { idleTimeoutSec: parsed.idleTimeoutSec } : {}),
		...(parsed.defaultLifecycle && LIFECYCLES.includes(parsed.defaultLifecycle) ? { defaultLifecycle: parsed.defaultLifecycle } : {}),
		...(typeof parsed.maxBufferSize === "number" && Number.isFinite(parsed.maxBufferSize) ? { maxBufferSize: parsed.maxBufferSize } : {}),
	};
}
