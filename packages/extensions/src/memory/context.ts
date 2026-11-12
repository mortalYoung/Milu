import { createHash } from "node:crypto";

import { readPersonaDoc } from "./persona.ts";
import { sopIndex, sopIndexReminder } from "./sop.ts";

export interface MemoryReminder {
	readonly text: string;
	readonly digest: string;
}

function digestOf(seed: string): string {
	return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

export async function buildPersonaReminder(dir: string): Promise<MemoryReminder | null> {
	const persona = await readPersonaDoc(dir);
	if (!persona) return null;
	const digest = digestOf(`${persona.meta.rev}\n${persona.meta.updated}\n${persona.meta.sources.join(",")}`);
	return { text: `<persona_reminder digest="${digest}">\n${persona.body}\n</persona_reminder>`, digest };
}

export async function buildSopIndexReminder(dir: string): Promise<MemoryReminder | null> {
	return sopIndexReminder(await sopIndex(dir));
}
