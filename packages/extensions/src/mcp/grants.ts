import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Session } from "@milu/core";

function grantsPath(session: Session): string {
	return join(session.root, "mcp-grants.json");
}

export async function setGrantedServer(session: Session, name: string, granted: boolean): Promise<void> {
	const current = await grantedServers(session);
	const next = granted ? (current.includes(name) ? current : [...current, name]) : current.filter((each) => each !== name);
	if (granted && next.length === current.length) return;
	await writeFile(grantsPath(session), `${JSON.stringify({ servers: next }, null, 2)}\n`, "utf8");
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
