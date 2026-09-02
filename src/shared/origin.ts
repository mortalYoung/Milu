/**
 * Origin — the cleaned, project-level SSOT derived from the raw JSONL file.
 *
 * raw  = file content (debug only)
 * origin = cleanOrigin(raw): entries that are valid and free of redundant noise.
 *
 * Cleaning rules (see docs/2026-09-02-origin-slice-view-naming.md):
 *  1. validity: drop entries without a usable identity;
 *  2. request/header dedup: keep the first occurrence of each distinct
 *     system+tool header — later identical headers are redundant noise.
 * Display rules (shell heartbeats, per-view dedup) intentionally stay in the
 * view/timeline projections, NOT here: slice (model) must still see them.
 */
import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENTS } from "./events";

function isUsable(entry: Entry): boolean {
	return entry != null && typeof entry.id === "string" && entry.id.length > 0;
}

function headerKey(data: unknown): string | null {
	if (!data || typeof data !== "object") return null;
	const d = data as { systemPrompt?: unknown; toolNames?: unknown };
	return JSON.stringify({ systemPrompt: d.systemPrompt ?? null, toolNames: d.toolNames ?? null });
}

export function cleanOrigin(raw: Entry[]): Entry[] {
	const seenHeaders = new Set<string>();
	const out: Entry[] = [];
	for (const entry of raw) {
		if (!isUsable(entry)) continue;
		if (entry.type === "custom" && entry.customType === EVENTS.requestHeader) {
			const key = headerKey(entry.data);
			if (key == null) continue;
			if (seenHeaders.has(key)) continue;
			seenHeaders.add(key);
		}
		out.push(entry);
	}
	return out;
}
