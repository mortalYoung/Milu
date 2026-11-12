import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Entry } from "@milu/core";

import { readPersonaDoc } from "./persona.ts";
import { readSopDocs, sectionBody } from "./sop.ts";
import {
	memoryDir,
	memoryFilePath,
	memoryPendingStatus,
	memoryRunsFilePath,
	type MemoryKind,
	type MemoryRecord,
	RECALL_MAX_DETAIL_CHARS,
	readMemoryLines,
	readMemoryRunSummaries,
	watermarksFilePath,
} from "./store.ts";

export interface MemoryOverviewFile {
	readonly label: string;
	readonly bytes: number;
}

export interface MemoryOverviewRecord {
	readonly id: string;
	readonly kind: MemoryKind;
	readonly createdAt: number;
	readonly summary: string;
	readonly detail?: string;
	readonly superseded: boolean;
	readonly overRecallCap: boolean;
	readonly sourceCount: number;
}

export interface MemoryOverviewSop {
	readonly id: string;
	readonly title: string;
	readonly when: string;
	readonly updated: string;
	readonly rev: number;
	readonly sourceCount: number;
}

export interface MemoryOverviewPersona {
	readonly rev: number;
	readonly updated: string;
	readonly content: string;
	readonly sourceCount: number;
}

export interface MemoryOverviewRun {
	readonly runId: string;
	readonly stage: string;
	readonly reason: string;
	readonly startedAt: number;
	readonly durationMs: number;
	readonly added: number;
	readonly error?: string;
}

export interface MemoryOverview {
	readonly totalBytes: number;
	readonly resultsBytes: number;
	readonly traceBytes: number;
	readonly results: readonly MemoryOverviewFile[];
	readonly trace: readonly MemoryOverviewFile[];
	readonly records: readonly MemoryOverviewRecord[];
	readonly supersededCount: number;
	readonly sops: readonly MemoryOverviewSop[];
	readonly persona: MemoryOverviewPersona | null;
	readonly runs: readonly MemoryOverviewRun[];
	readonly runsTotal: number;
	readonly pending: { readonly pending: boolean; readonly rounds: number };
	readonly agentDetailLimit: number;
}

const RUN_LIST_LIMIT = 50;

async function fileBytes(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

async function directoryBytes(root: string, label: string, prefix = ""): Promise<MemoryOverviewFile[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(join(root, prefix), { withFileTypes: true });
	} catch {
		return [];
	}
	const out: MemoryOverviewFile[] = [];
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...(await directoryBytes(root, label, relative)));
		else out.push({ label: `${label}/${relative}`, bytes: await fileBytes(join(root, relative)) });
	}
	return out;
}

async function memoryStorage(dir: string): Promise<{ results: MemoryOverviewFile[]; trace: MemoryOverviewFile[] }> {
	const candidates = [
		{ label: "memories.jsonl", path: memoryFilePath(dir) },
		{ label: "persona.md", path: join(memoryDir(dir), "persona.md") },
		{ label: "watermarks.json", path: watermarksFilePath(dir) },
	];
	const measured = await Promise.all(candidates.map(async (file) => ({ label: file.label, bytes: await fileBytes(file.path) })));
	const directories = [...(await directoryBytes(join(memoryDir(dir), "views"), "views")), ...(await directoryBytes(join(memoryDir(dir), "sops"), "sops"))];
	const results = [...measured.filter((file) => file.bytes > 0), ...directories.filter((file) => file.bytes > 0)];
	const trace = [{ label: "runs.jsonl", bytes: await fileBytes(memoryRunsFilePath(dir)) }].filter((file) => file.bytes > 0);
	return { results, trace };
}

export async function buildMemoryOverview(dir: string, entries: readonly Entry[]): Promise<MemoryOverview> {
	const lines = await readMemoryLines(dir);
	const supersededIds = new Set<string>();
	for (const line of lines) {
		if (line.kind === "checkpoint") continue;
		if (line.kind === "update" && line.supersedes) supersededIds.add(line.supersedes);
	}
	const records = lines
		.filter((line): line is MemoryRecord => line.kind !== "checkpoint")
		.map((record): MemoryOverviewRecord => ({
			id: record.id,
			kind: record.kind,
			createdAt: record.eventAt ?? record.createdAt,
			summary: record.summary,
			...(record.detail ? { detail: record.detail } : {}),
			superseded: supersededIds.has(record.id),
			overRecallCap: (record.detail?.length ?? 0) > RECALL_MAX_DETAIL_CHARS,
			sourceCount: record.source.rawIds.length,
		}))
		.reverse();

	const pending = await memoryPendingStatus(dir, entries);
	const sops = (await readSopDocs(dir)).map((doc) => ({
		id: doc.meta.id,
		title: doc.meta.title,
		when: sectionBody(doc.body, "When").split("\n")[0]?.trim() ?? "",
		updated: doc.meta.updated,
		rev: doc.meta.rev,
		sourceCount: doc.meta.sources.length,
	}));
	const persona = await readPersonaDoc(dir);
	const { runs, total } = await readMemoryRunSummaries(dir, RUN_LIST_LIMIT);
	const storage = await memoryStorage(dir);
	const resultsBytes = storage.results.reduce((sum, file) => sum + file.bytes, 0);
	const traceBytes = storage.trace.reduce((sum, file) => sum + file.bytes, 0);

	return {
		totalBytes: resultsBytes + traceBytes,
		resultsBytes,
		traceBytes,
		results: storage.results,
		trace: storage.trace,
		records,
		supersededCount: records.filter((record) => record.superseded).length,
		sops,
		persona: persona ? { rev: persona.meta.rev, updated: persona.meta.updated, content: persona.body, sourceCount: persona.meta.sources.length } : null,
		runs: runs
			.map((run) => ({
				runId: run.runId,
				stage: run.stage,
				reason: run.reason,
				startedAt: run.startedAt,
				durationMs: run.durationMs,
				added: run.added,
				...(run.error ? { error: run.error } : {}),
			}))
			.reverse(),
		runsTotal: total,
		pending,
		agentDetailLimit: RECALL_MAX_DETAIL_CHARS,
	};
}
