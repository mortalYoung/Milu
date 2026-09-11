import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryOverview, MemoryRecordView, MemoryRunTraceView, MemoryRunView, MemorySizeEntry } from "../../shared/rpc";
import type { SessionStore } from "../persist";
import {
	type MemoryRecord,
	memoryDir,
	memoryFilePath,
	memoryPendingStatus,
	memoryRunsFilePath,
	projectMemoryTrajectory,
	RECALL_MAX_DETAIL_CHARS,
	readMemoryLines,
	readMemoryRun,
	readMemoryRunSummaries,
} from "./memory";
import { latestPersona, personaFilePath, readPersonaLines } from "./persona";
import { foldScenes, readSceneLines, scenesFilePath } from "./scenes";

type SessionReader = Pick<SessionStore, "listSessions" | "currentSessionFile" | "rawEntries">;

const RUN_LIST_LIMIT = 50;

async function fileBytes(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

async function viewFileBytes(dir: string, prefix = ""): Promise<MemorySizeEntry[]> {
	const root = join(memoryDir(dir), "views");
	let entries: Dirent[];
	try {
		entries = await readdir(join(root, prefix), { withFileTypes: true });
	} catch {
		return [];
	}
	const out: MemorySizeEntry[] = [];
	for (const entry of entries) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...(await viewFileBytes(dir, relative)));
		else out.push({ label: `views/${relative}`, bytes: await fileBytes(join(root, relative)) });
	}
	return out;
}

async function memoryStorage(dir: string): Promise<{ results: MemorySizeEntry[]; trace: MemorySizeEntry[] }> {
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

export async function buildMemoryOverview(session: SessionReader, dir: string): Promise<MemoryOverview> {
	const lines = await readMemoryLines(dir);
	const supersededIds = new Set<string>();
	for (const line of lines) {
		if (line.kind === "checkpoint") continue;
		for (const relation of line.relations ?? []) if (relation.type === "supersedes") supersededIds.add(relation.targetId);
	}
	const records: MemoryRecordView[] = lines
		.filter((line): line is MemoryRecord => line.kind !== "checkpoint")
		.map((record) => ({
			id: record.id,
			kind: record.kind,
			createdAt: record.createdAt,
			summary: record.data.summary,
			...(record.data.detail ? { detail: record.data.detail } : {}),
			...(record.scene ? { scene: record.scene } : {}),
			superseded: supersededIds.has(record.id),
			overRecallCap: (record.data.detail?.length ?? 0) > RECALL_MAX_DETAIL_CHARS,
			source: { rawCount: record.source.rawIds.length },
		}))
		.reverse();

	const sessions = await session.listSessions(dir);
	let pending = { pending: false, rounds: 0 };
	if (sessions.length > 0) {
		const entries = await session.rawEntries(dir);
		pending = await memoryPendingStatus(dir, entries);
	}

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
	const resultsBytes = storage.results.reduce((acc, file) => acc + file.bytes, 0);
	const traceBytes = storage.trace.reduce((acc, file) => acc + file.bytes, 0);

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
		runs: runs.map(
			(run): MemoryRunView => ({
				runId: run.runId,
				stage: run.stage,
				reason: run.reason,
				startedAt: run.startedAt,
				durationMs: run.durationMs,
				added: run.added,
				bytes: run.bytes,
				...(run.usage ? { usage: run.usage } : {}),
			}),
		),
		runsTotal: total,
		pending,
		agentDetailLimit: RECALL_MAX_DETAIL_CHARS,
	};
}

export async function readMemoryRunTrace(dir: string, runId: string): Promise<MemoryRunTraceView | null> {
	const record = await readMemoryRun(dir, runId);
	if (!record) return null;
	return {
		runId: record.runId,
		stage: record.stage,
		reason: record.reason,
		startedAt: record.startedAt,
		durationMs: record.durationMs,
		added: record.added,
		bytes: Buffer.byteLength(JSON.stringify(record), "utf8"),
		...(record.usage ? { usage: record.usage } : {}),
		...(record.error ? { error: record.error } : {}),
		model: record.model,
		attempts: record.attempts,
		targetRawId: record.targetRawId,
		cursorRawId: record.cursorRawId,
		...(record.checkpoints ? { checkpoints: record.checkpoints } : {}),
		trace: record.trace ?? [],
		attemptsView: projectMemoryTrajectory(record.trajectory ?? []),
	};
}
