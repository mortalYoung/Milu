import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@milu/server";

import { createBackend } from "./backend.ts";

const CONFIG_ROOT = process.env["MILU_CONFIG"] ?? join(homedir(), ".config", "milu");
const WORKSPACE = process.env["MILU_WORKSPACE"] ?? process.cwd();
const WEB_DIR = process.env["MILU_WEB_DIR"] ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));

/** The web end, end to end: core, transport, and the built page on one loopback origin. */
const backend = await createBackend({ root: CONFIG_ROOT, workspace: WORKSPACE });
const server = await serve({ backend, configRoot: CONFIG_ROOT, workspace: WORKSPACE, webDir: WEB_DIR });

async function shutdown(): Promise<void> {
	await server.close();
	await backend.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void shutdown().finally(() => process.exit(0)));
