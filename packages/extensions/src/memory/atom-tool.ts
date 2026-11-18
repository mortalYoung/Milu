import { type AgentTool, Type } from "@milu/core";

import { isoDay, type MemoryRecord } from "./store.ts";

export const ATOM_PAGE = 30;
const PAGE_CHARS = 6_000;

const readAtomsSchema = Type.Object({
	after: Type.Optional(Type.String({ description: "atom id to continue after; omit to start where this pass left off" })),
	limit: Type.Optional(Type.Integer({ description: `atoms to return (default ${ATOM_PAGE})` })),
});

export interface AtomCursor {
	next: number;
	through: string | null;
}

export const atomCursor = (): AtomCursor => ({ next: 0, through: null });

function lineOf(atom: MemoryRecord): string {
	const when = atom.eventAt ? `${isoDay(atom.eventAt)} ` : "";
	const subject = atom.subject ? ` · ${atom.subject}` : "";
	const predicate = atom.predicate ? ` / ${atom.predicate}` : "";
	return `[${atom.id}] ${when}${atom.kind}${subject}${predicate}: ${atom.summary}`;
}

export function createReadAtomsTool(atoms: readonly MemoryRecord[], cursor: AtomCursor, budget = Number.POSITIVE_INFINITY): AgentTool<typeof readAtomsSchema, { ok: boolean }> {
	const indexOf = new Map(atoms.map((atom, index) => [atom.id, index]));
	let used = 0;
	return {
		name: "read_atoms",
		label: "Atoms",
		description:
			'Read the atoms distilled for this partner, oldest first — one line per atom: "[id] date · kind · subject / predicate: summary". Page forward with after; the reply says how many are left and which id to continue from.',
		parameters: readAtomsSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const start = params.after === undefined ? cursor.next : (indexOf.get(params.after) ?? -2) + 1;
			if (start < 0)
				return {
					content: [{ type: "text" as const, text: `unknown atom id "${params.after}" — omit after to continue from where this pass left off` }],
					details: { ok: false },
				};
			const limit = Math.max(1, params.limit ?? ATOM_PAGE);
			const out: string[] = [];
			let chars = 0;
			let index = start;
			for (; index < atoms.length && out.length < limit; index += 1) {
				if (used + out.length >= budget) break;
				const text = lineOf(atoms[index]!);
				if (chars + text.length > PAGE_CHARS && out.length > 0) break;
				out.push(text);
				chars += text.length;
			}
			if (out.length > 0) {
				cursor.next = Math.max(cursor.next, index);
				cursor.through = out.length > 0 ? atoms[index - 1]!.id : cursor.through;
			}
			used += out.length;
			const remaining = atoms.length - index;
			const exhausted = used >= budget;
			const head = out.length === 0 ? "This pass has read its share of the atoms." : out.join("\n");
			const tail =
				index >= atoms.length
					? "\n\n(end of the atoms for this partner)"
					: `\n\n(${remaining} more; continue with after: "${atoms[index - 1]!.id}"${exhausted ? " — or call finish and let the next pass pick up from here" : ""})`;
			return { content: [{ type: "text" as const, text: `${head}${tail}` }], details: { ok: true } };
		},
	};
}
