import { randomUUID } from "node:crypto";

import { type AgentTool, type Model, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
import { appendMemoryLines, appendMemoryRun, ensureMemoryFile, type MemoryRecord, type MemoryRunLog, type MemoryRunReason, queryMemory, readMemoryLines } from "./store.ts";

const MAX_ATTEMPTS = 3;
const MAX_RECORDS = 200;
const MAX_TARGETS = 10;
const MAX_SOURCE_IDS = 50;

const writeMergeSchema = Type.Object({
	kind: Type.Union([
		Type.Literal("fact"),
		Type.Literal("decision"),
		Type.Literal("issue"),
		Type.Literal("reference"),
		Type.Literal("event"),
		Type.Literal("preference"),
		Type.Literal("instruction"),
	]),
	summary: Type.String({ description: "Merged memory statement" }),
	detail: Type.Optional(Type.String({ description: "Optional merged supporting detail" })),
	supersedes: Type.Array(Type.String(), { description: "Ids of the active memories being merged (at least one, at most 10)" }),
	scene: Type.Optional(Type.String({ description: "Optional merged theme name" })),
});

const finishSchema = Type.Object({});

interface ConsolidateState {
	readonly active: Map<string, MemoryRecord>;
	merges: number;
	finished: boolean;
}

function writeMergeTool(dir: string, state: ConsolidateState): AgentTool<typeof writeMergeSchema, { ok: boolean; error?: string }> {
	return {
		name: "write_merge",
		label: "Write Merge",
		description: "Merge a group of duplicate or fragmentary active memories into one new record that supersedes them.",
		parameters: writeMergeSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `write_merge rejected: ${message}` }], details: { ok: false, error: message } });
			const summary = params.summary.trim();
			if (!summary) return reject("summary is required");
			const supersedes = [...new Set(params.supersedes)];
			if (supersedes.length === 0) return reject("supersedes must list at least one active memory id");
			if (supersedes.length > MAX_TARGETS) return reject(`at most ${MAX_TARGETS} records can be merged at once`);
			for (const id of supersedes) {
				if (!state.active.has(id)) return reject(`"${id}" is not an active memory (already merged or unknown)`);
			}
			const targets = supersedes.map((id) => state.active.get(id)!);
			const rawIds = [...new Set(targets.flatMap((target) => target.source.rawIds))].slice(0, MAX_SOURCE_IDS);
			const scene = params.scene?.trim() || (targets.every((target) => target.scene === targets[0]?.scene) ? targets[0]?.scene : undefined);
			const detail = params.detail?.trim();
			const record: MemoryRecord = {
				id: `mem-${randomUUID()}`,
				createdAt: Date.now(),
				kind: params.kind,
				source: { rawIds },
				data: { summary, ...(detail ? { detail } : {}) },
				relations: supersedes.map((id) => ({ type: "supersedes" as const, targetId: id })),
				...(scene ? { scene } : {}),
				...(targets.some((target) => target.remember === true) ? { remember: true as const } : {}),
			};
			await appendMemoryLines(dir, [record]);
			for (const id of supersedes) state.active.delete(id);
			state.merges += 1;
			return { content: [{ type: "text", text: `merged ${supersedes.length} memories into ${record.id}` }], details: { ok: true } };
		},
	};
}

function finishTool(state: ConsolidateState): AgentTool<typeof finishSchema, { ok: boolean }> {
	return {
		name: "finish",
		label: "Finish",
		description: "Finish the consolidation pass once every merge worth doing has been written.",
		parameters: finishSchema,
		executionMode: "sequential",
		async execute() {
			state.finished = true;
			return { content: [{ type: "text", text: "Consolidation finished." }], details: { ok: true }, terminate: true };
		},
	};
}

function consolidatePrompt(records: readonly MemoryRecord[], total: number): string {
	const lines = ["Active memories (newest first):"];
	lines.push(
		records
			.map(
				(record) =>
					`- [${record.id}] ${record.kind}${record.scene ? ` (scene: ${record.scene})` : ""}: ${record.data.summary}${record.data.detail ? `\n  ${record.data.detail.slice(0, 400)}` : ""}`,
			)
			.join("\n"),
	);
	if (total > records.length) lines.push("", `(${total - records.length} older memories were not included in this pass.)`);
	lines.push("", "Merge duplicates or fragments with write_merge, then call finish. If nothing should be merged, call finish directly.");
	return lines.join("\n");
}

export interface ConsolidateMemoryOptions {
	readonly dir: string;
	readonly model: Model<any>;
	readonly streamFn: StreamFn;
	readonly signal?: AbortSignal;
	readonly logRun?: MemoryRunLog;
}

const WORKFLOW = `You consolidate this partner's long-term memories.

Merge groups that state the same fact, or fragments that belong together, into one record:
- Call write_merge with the merged kind/summary/detail and list the ids of the records being replaced in supersedes.
- Preserve all distinct information from the merged records; never invent anything.
- Only merge true duplicates or fragments of one fact — never merge merely related items.
- A record can be superseded at most once; previously merged ids are no longer active.
- If nothing should be merged, call finish without writing.`;

export async function consolidateMemory(opts: ConsolidateMemoryOptions): Promise<number> {
	await ensureMemoryFile(opts.dir);
	const lines = await readMemoryLines(opts.dir);
	const records = queryMemory(lines, { limit: MAX_RECORDS });
	if (records.length < 2) return 0;
	const activeTotal = queryMemory(lines, { limit: Number.MAX_SAFE_INTEGER }).length;
	const state: ConsolidateState = { active: new Map(records.map((record) => [record.id, record])), merges: 0, finished: false };
	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	let attempts = 0;
	let added = 0;

	if (opts.logRun) {
		try {
			await opts.logRun.start({ runId, stage: "consolidate", startedAt });
		} catch (error) {
			console.error("consolidate run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunReason, error?: string) {
		const endedAt = Date.now();
		try {
			await opts.logRun?.end({ runId, stage: "consolidate", startedAt, endedAt, reason, added });
		} catch (logError) {
			console.error("consolidate run end log failed:", logError);
		}
		try {
			await appendMemoryRun(opts.dir, {
				runId,
				stage: "consolidate",
				model: `${opts.model.provider}/${opts.model.id ?? "default"}`,
				startedAt,
				endedAt,
				durationMs: endedAt - startedAt,
				reason,
				attempts,
				added,
				targetRawId: null,
				cursorRawId: null,
				...(error ? { error } : {}),
			});
		} catch (runError) {
			console.error("consolidate run append failed:", runError);
		}
	}

	try {
		while (attempts < MAX_ATTEMPTS && !state.finished) {
			if (opts.signal?.aborted) break;
			const agent = createMemoryAgent(opts.model, opts.streamFn, WORKFLOW, [writeMergeTool(opts.dir, state), finishTool(state)]);
			const onAbort = () => agent.abort();
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			try {
				await agent.prompt(consolidatePrompt([...state.active.values()], activeTotal));
				await agent.waitForIdle();
			} finally {
				opts.signal?.removeEventListener("abort", onAbort);
			}
			if (opts.signal?.aborted) break;
			attempts += 1;
		}
		added = state.merges;
		await endRun(opts.signal?.aborted ? "interrupted" : state.finished ? "completed" : "unfinished");
		return added;
	} catch (error) {
		added = state.merges;
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	}
}
