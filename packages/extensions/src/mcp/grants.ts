import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Session } from "@milu/core";

function grantsPath(session: Session): string {
	return join(session.root, "mcp-grants.json");
}

export async function grantedServers(session: Session): Promise<string[]> {
	const text = await readFile(grantsPath(session), "utf8").catch(() => null);
	if (text === null) return [];
	try {
		const saved = JSON.parse(text) as { servers?: unknown };
		return Array.isArray(saved.servers) ? saved.servers.filter((name): name is string => typeof name === "string") : [];
	} catch {
		return [];
	}
}
