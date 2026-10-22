import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { Entry } from "@milu/core";

import { latestPersona, personaFilePath, readPersonaLines } from "./persona.ts";
import { foldScenes, readSceneLines, scenesFilePath } from "./scenes.ts";
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
	readonly scene?: string;
	readonly superseded: boolean;
	readonly overRecallCap: boolean;
	readonly sourceCount: number;
}

export interface MemoryOverviewScene {
	readonly sceneId: string;
	readonly name: string;
	readonly summary: string;
	readonly content: string;
	readonly heat: number;
	readonly updatedAt: number;
	readonly sourceCount: number;
}

export interface MemoryOverviewProfile {
	readonly version: number;
	readonly createdAt: number;
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
	readonly scenes: readonly MemoryOverviewScene[];
	readonly profile: MemoryOverviewProfile | null;
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

async function viewFileBytes(dir: string, prefix = ""): Promise<MemoryOverviewFile[]> {
	const root = join(memoryDir(dir), "views");
	let entries: Dirent[];
	try {
		entries = await readdir(join(root, prefix), { withFileTypes: true });
	} catch {
		return [];
	}
	const out: MemoryOverviewFile[] = [];
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...(await viewFileBytes(dir, relative)));
		else out.push({ label: `views/${relative}`, bytes: await fileBytes(join(root, relative)) });
	}
	return out;
}

async function memoryStorage(dir: string): Promise<{ results: MemoryOverviewFile[]; trace: MemoryOverviewFile[] }> {
	const candidates = [
		{ label: "memories.jsonl", path: memoryFilePath(dir) },
		{ label: "scenes.jsonl", path: scenesFilePath(dir) },
		{ label: "persona.jsonl", path: personaFilePath(dir) },
	];
	const measured = await Promise.all(candidates.map(async (file) => ({ label: file.label, bytes: await fileBytes(file.path) })));
	const results = [...measured.filter((file) => file.bytes > 0), ...(await viewFileBytes(dir)).filter((file) => file.bytes > 0)];
	const trace = [{ label: "runs.jsonl", bytes: await fileBytes(memoryRunsFilePath(dir)) }].filter((file) => file.bytes > 0);
	return { results, trace };
}

export async function buildMemoryOverview(dir: string, entries: readonly Entry[]): Promise<MemoryOverview> {
	const lines = await readMemoryLines(dir);
	const supersededIds = new Set<string>();
	for (const line of lines) {
		if (line.kind === "checkpoint") continue;
		for (const relation of line.relations ?? []) if (relation.type === "supersedes") supersededIds.add(relation.targetId);
	}
	const records = lines
		.filter((line): line is MemoryRecord => line.kind !== "checkpoint")
		.map((record): MemoryOverviewRecord => ({
			id: record.id,
			kind: record.kind,
			createdAt: record.createdAt,
			summary: record.data.summary,
			...(record.data.detail ? { detail: record.data.detail } : {}),
			...(record.scene ? { scene: record.scene } : {}),
			superseded: supersededIds.has(record.id),
			overRecallCap: (record.data.detail?.length ?? 0) > RECALL_MAX_DETAIL_CHARS,
			sourceCount: record.source.rawIds.length,
		}))
		.reverse();

	const pending = await memoryPendingStatus(dir, entries);
	const scenes = foldScenes(await readSceneLines(dir)).map((scene) => ({
		sceneId: scene.sceneId,
		name: scene.name,
		summary: scene.summary,
		content: scene.content,
		heat: scene.heat,
		updatedAt: scene.updatedAt,
		sourceCount: scene.sourceMemoryIds.length,
	}));
	const persona = latestPersona(await readPersonaLines(dir));
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
		scenes,
		profile: persona ? { version: persona.version, createdAt: persona.createdAt, content: persona.content, sourceCount: persona.sourceSceneIds.length } : null,
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
