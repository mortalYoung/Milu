import type { Entry } from "@earendil-works/pi-agent-core";
import { EVENT_META, entryKey } from "./entry-meta";

function isUsable(entry: Entry): boolean {
	return entry != null && typeof entry.id === "string" && entry.id.length > 0;
}

export function projectOrigin(raw: Entry[]): Entry[] {
	const out: Entry[] = [];
	for (const entry of raw) {
		if (!isUsable(entry)) continue;
		const meta = EVENT_META[entryKey(entry)];
		if (meta?.origin?.visit) meta.origin.visit(entry, out);
		else out.push(entry);
	}
	return out;
}
