import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentMessage } from "@milu/core";

import { queryMemory, readMemoryLines, type MemoryRecord } from "./store.ts";

interface Persona {
	readonly id: string;
	readonly version: number;
	readonly content: string;
}

async function readPersona(dir: string): Promise<Persona | null> {
	try {
		const raw = await readFile(join(dir, ".memory", "persona.jsonl"), "utf8");
		let latest: Persona | null = null;
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as Persona;
				if (typeof parsed.id !== "string" || typeof parsed.content !== "string") continue;
				if (!latest || parsed.version >= latest.version) latest = parsed;
			} catch {}
		}
		return latest;
	} catch {
		return null;
	}
}

async function readNavigation(dir: string): Promise<string | null> {
	try {
		const text = await readFile(join(dir, ".memory", "views", "navigation.txt"), "utf8");
		return text.trim() === "" ? null : text;
	} catch {
		return null;
	}
}

export interface MemoryContext {
	readonly text: string;
	readonly digest: string;
}

export async function buildMemoryContext(dir: string): Promise<MemoryContext | null> {
	const [persona, navigation, lines] = await Promise.all([readPersona(dir), readNavigation(dir), readMemoryLines(dir)]);
	const records = queryMemory(lines, { limit: 20 });
	if (!persona && !navigation && records.length === 0) return null;

	const includeRecords = !persona && !navigation;
	const digest = createHash("sha256")
		.update(JSON.stringify({ persona: persona?.id ?? null, navigation, records: includeRecords ? records.map((record) => record.id) : [] }))
		.digest("hex")
		.slice(0, 16);
	const parts = [`<memory_context digest="${digest}">`];
	if (persona) parts.push("# LONG-TERM PROFILE", "", persona.content);
	if (navigation) parts.push("", navigation.trim());
	if (includeRecords) parts.push("# DURABLE MEMORIES", "", records.map(recordLine).join("\n"));
	parts.push("</memory_context>");
	return { text: parts.join("\n"), digest };
}

function recordLine(record: MemoryRecord): string {
	return `- [${record.kind}] ${record.data.summary}${record.scene ? ` (scene: ${record.scene})` : ""}`;
}

export function lastMemoryDigest(messages: readonly AgentMessage[]): string | null {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const content = (messages[index] as { content?: unknown }).content;
		if (typeof content !== "string") continue;
		const match = /<memory_context digest="([^"]+)">/.exec(content);
		if (match) return match[1] ?? null;
	}
	return null;
}
