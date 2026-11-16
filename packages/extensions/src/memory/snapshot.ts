import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Entry } from "@milu/core";

import { readPersonaDoc } from "./persona.ts";
import { readSopDocs, sectionBody } from "./sop.ts";
import {
	activeRecords,
	conflictsOf,
	memoryDir,
	memoryFilePath,
	memoryPendingStatus,
	memoryRunsFilePath,
	type MemoryConflict,
	type MemoryItem,
	type MemoryKind,
	type MemoryRecord,
	type MemoryRunStage,
	type MemoryRunSummary,
	type MemoryValue,
	RECALL_MAX_DETAIL_CHARS,
	RECALL_MAX_MATCHES,
	RECALL_MAX_TOTAL_CHARS,
	readMemoryLines,
	readMemoryRunSummaries,
	watermarksFilePath,
} from "./store.ts";

export interface MemorySnapshotFacet {
	readonly subject?: string;
	readonly predicate?: string;
	readonly value?: MemoryValue;
	readonly direction?: "prefer" | "avoid";
	readonly scope?: string;
	readonly appliesTo?: string;
	readonly old?: MemoryValue;
	readonly next?: MemoryValue;
}

export interface MemorySnapshotFact {
	readonly provider?: "user" | "assistant" | "external";
	readonly outcome?: "done" | "decision" | "issue";
	readonly at?: number;
}

export type MemoryAtomStatus = "active" | "superseded" | "conflict";

export interface MemorySnapshotAtom {
	readonly id: string;
	readonly kind: MemoryKind;
	readonly createdAt: number;
	readonly eventAt: number;
	readonly summary: string;
	readonly detail?: string;
	readonly facet?: MemorySnapshotFacet;
	readonly fact?: MemorySnapshotFact;
	readonly items?: readonly MemoryItem[];
	readonly supersedes?: string;
	readonly supersededBy: readonly string[];
	readonly status: MemoryAtomStatus;
	readonly overRecallCap: boolean;
	readonly sources: { readonly rawIds: readonly string[]; readonly count: number };
}

export interface MemorySnapshotSop {
	readonly id: string;
	readonly title: string;
	readonly rev: number;
	readonly confidence: number;
	readonly updated: string;
	readonly purpose: string;
	readonly when: string;
	readonly procedure: string;
	readonly checklist: string;
	readonly pitfalls: string;
	readonly evidence: readonly { readonly atomId: string; readonly date: string; readonly note: string }[];
	readonly sources: readonly string[];
}

export interface MemorySnapshotPersona {
	readonly rev: number;
	readonly updated: string;
	readonly sources: readonly string[];
	readonly relationship: string;
	readonly taste: string;
}

export interface MemorySnapshotFile {
	readonly label: string;
	readonly bytes: number;
}

export interface MemorySnapshotNumbers {
	readonly active: number;
	readonly superseded: number;
	readonly conflict: number;
}

export interface MemorySnapshotLimits {
	readonly recallDetail: number;
	readonly recallTotal: number;
	readonly maxMatches: number;
	readonly maxSops: number;
	readonly pendingRounds: number;
	readonly digestItems: number;
}

export interface MemorySnapshotRunning {
	readonly runId: string;
	readonly stage: MemoryRunStage;
	readonly startedAt: number;
}

export interface MemorySnapshot {
	readonly partner: string;
	readonly updatedAt: number;
	readonly enabled: boolean;
	readonly atoms: readonly MemorySnapshotAtom[];
	readonly counts: MemorySnapshotNumbers;
	readonly conflicts: readonly MemoryConflict[];
	readonly sops: readonly MemorySnapshotSop[];
	readonly persona: MemorySnapshotPersona | null;
	readonly runs: readonly MemoryRunSummary[];
	readonly runsTotal: number;
	readonly pending: { readonly pending: boolean; readonly rounds: number };
	readonly running: readonly MemorySnapshotRunning[];
	readonly storage: { readonly total: number; readonly results: readonly MemorySnapshotFile[]; readonly trace: readonly MemorySnapshotFile[] };
	readonly limits: MemorySnapshotLimits;
}

export interface MemorySummary {
	readonly active: number;
	readonly superseded: number;
	readonly conflicts: number;
	readonly sops: number;
	readonly personaRev: number | null;
	readonly truncated: number;
	readonly pending: { readonly pending: boolean; readonly rounds: number };
}

export interface MemorySnapshotContext {
	readonly partner: string;
	readonly running?: readonly MemorySnapshotRunning[];
	readonly enabled?: boolean;
	readonly maxSops?: number;
	readonly pendingRounds?: number;
	readonly digestItems?: number;
	readonly now?: number;
}

const RUN_LIST_LIMIT = 50;

async function fileBytes(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

async function directoryBytes(root: string, label: string, prefix = ""): Promise<MemorySnapshotFile[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(join(root, prefix), { withFileTypes: true });
	} catch {
		return [];
	}
	const out: MemorySnapshotFile[] = [];
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...(await directoryBytes(root, label, relative)));
		else out.push({ label: `${label}/${relative}`, bytes: await fileBytes(join(root, relative)) });
	}
	return out;
}

async function memoryStorage(dir: string): Promise<{ results: MemorySnapshotFile[]; trace: MemorySnapshotFile[] }> {
	const candidates = [
		{ label: "memories.jsonl", path: memoryFilePath(dir) },
		{ label: "persona.md", path: join(memoryDir(dir), "persona.md") },
		{ label: "watermarks.json", path: watermarksFilePath(dir) },
	];
	const measured = await Promise.all(candidates.map(async (file) => ({ label: file.label, bytes: await fileBytes(file.path) })));
	const directories = [...(await directoryBytes(join(memoryDir(dir), "views"), "views")), ...(await directoryBytes(join(memoryDir(dir), "sops"), "sops"))];
	const results = [...measured.filter((file) => file.bytes > 0), ...directories.filter((file) => file.bytes > 0)];
	const trace = [{ label: "runs.jsonl", bytes: await fileBytes(memoryRunsFilePath(dir)) }, ...(await directoryBytes(join(memoryDir(dir), "traces"), "traces"))].filter(
		(file) => file.bytes > 0,
	);
	return { results, trace };
}

function facetOf(record: MemoryRecord): MemorySnapshotFacet | undefined {
	const facet: MemorySnapshotFacet = {
		...(record.subject === undefined ? {} : { subject: record.subject }),
		...(record.predicate === undefined ? {} : { predicate: record.predicate }),
		...(record.value === undefined ? {} : { value: record.value }),
		...(record.direction === undefined ? {} : { direction: record.direction }),
		...(record.scope === undefined ? {} : { scope: record.scope }),
		...(record.appliesTo === undefined ? {} : { appliesTo: record.appliesTo }),
		...(record.old === undefined ? {} : { old: record.old }),
		...(record.next === undefined ? {} : { next: record.next }),
	};
	return Object.keys(facet).length === 0 ? undefined : facet;
}

function factOf(record: MemoryRecord): MemorySnapshotFact | undefined {
	const fact: MemorySnapshotFact = {
		...(record.provider === undefined ? {} : { provider: record.provider }),
		...(record.outcome === undefined ? {} : { outcome: record.outcome }),
		...(record.at === undefined ? {} : { at: record.at }),
	};
	return Object.keys(fact).length === 0 ? undefined : fact;
}

export async function buildMemorySnapshot(dir: string, entries: readonly Entry[], context: MemorySnapshotContext): Promise<MemorySnapshot> {
	const lines = await readMemoryLines(dir);
	const records = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	const supersededBy = new Map<string, string[]>();
	const superseded = new Set<string>();
	for (const record of records) {
		if (record.kind !== "update" || !record.supersedes) continue;
		superseded.add(record.supersedes);
		supersededBy.set(record.supersedes, [...(supersededBy.get(record.supersedes) ?? []), record.id]);
	}
	const conflicts = conflictsOf(activeRecords(lines));
	const conflicted = new Set(conflicts.flatMap((conflict) => conflict.ids));

	const atoms = records
		.map((record): MemorySnapshotAtom => {
			const facet = facetOf(record);
			const fact = factOf(record);
			return {
				id: record.id,
				kind: record.kind,
				createdAt: record.createdAt,
				eventAt: record.eventAt ?? record.createdAt,
				summary: record.summary,
				...(record.detail === undefined ? {} : { detail: record.detail }),
				...(facet === undefined ? {} : { facet }),
				...(fact === undefined ? {} : { fact }),
				...(record.items === undefined ? {} : { items: record.items }),
				...(record.supersedes === undefined ? {} : { supersedes: record.supersedes }),
				supersededBy: supersededBy.get(record.id) ?? [],
				status: superseded.has(record.id) ? "superseded" : conflicted.has(record.id) ? "conflict" : "active",
				overRecallCap: (record.detail?.length ?? 0) > RECALL_MAX_DETAIL_CHARS,
				sources: { rawIds: record.source.rawIds, count: record.source.rawIds.length },
			};
		})
		.reverse();

	const counts = {
		active: atoms.filter((atom) => atom.status === "active").length,
		superseded: atoms.filter((atom) => atom.status === "superseded").length,
		conflict: atoms.filter((atom) => atom.status === "conflict").length,
	};

	const sops = (await readSopDocs(dir))
		.map((doc): MemorySnapshotSop => ({
			id: doc.meta.id,
			title: doc.meta.title,
			rev: doc.meta.rev,
			confidence: doc.meta.confidence,
			updated: doc.meta.updated,
			purpose: sectionBody(doc.body, "Purpose"),
			when: sectionBody(doc.body, "When"),
			procedure: sectionBody(doc.body, "Procedure"),
			checklist: sectionBody(doc.body, "Checklist"),
			pitfalls: sectionBody(doc.body, "Pitfalls"),
			evidence: doc.meta.evidence,
			sources: doc.meta.sources,
		}))
		.sort((left, right) => right.rev - left.rev || left.id.localeCompare(right.id));

	const personaDoc = await readPersonaDoc(dir);
	const persona: MemorySnapshotPersona | null = personaDoc
		? {
				rev: personaDoc.meta.rev,
				updated: personaDoc.meta.updated,
				sources: personaDoc.meta.sources,
				relationship: sectionBody(personaDoc.body, "Relationship"),
				taste: sectionBody(personaDoc.body, "Taste"),
			}
		: null;

	const { runs, total } = await readMemoryRunSummaries(dir, RUN_LIST_LIMIT);
	const storage = await memoryStorage(dir);
	const pending = await memoryPendingStatus(dir, entries);
	const results = storage.results.reduce((sum, file) => sum + file.bytes, 0);
	const trace = storage.trace.reduce((sum, file) => sum + file.bytes, 0);

	return {
		partner: context.partner,
		updatedAt: context.now ?? Date.now(),
		enabled: context.enabled !== false,
		atoms,
		counts,
		conflicts,
		sops,
		persona,
		runs,
		runsTotal: total,
		pending,
		running: context.running ?? [],
		storage: { total: results + trace, results: storage.results, trace: storage.trace },
		limits: {
			recallDetail: RECALL_MAX_DETAIL_CHARS,
			recallTotal: RECALL_MAX_TOTAL_CHARS,
			maxMatches: RECALL_MAX_MATCHES,
			maxSops: context.maxSops ?? 0,
			pendingRounds: context.pendingRounds ?? 0,
			digestItems: context.digestItems ?? 0,
		},
	};
}

export async function buildMemorySummary(dir: string, entries: readonly Entry[]): Promise<MemorySummary> {
	const lines = await readMemoryLines(dir);
	const records = lines.filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	const active = activeRecords(lines);
	const conflicts = conflictsOf(active);
	const persona = await readPersonaDoc(dir);
	return {
		active: active.length,
		superseded: records.length - active.length,
		conflicts: conflicts.length,
		sops: (await readSopDocs(dir)).length,
		personaRev: persona?.meta.rev ?? null,
		truncated: records.filter((record) => (record.detail?.length ?? 0) > RECALL_MAX_DETAIL_CHARS).length,
		pending: await memoryPendingStatus(dir, entries),
	};
}
