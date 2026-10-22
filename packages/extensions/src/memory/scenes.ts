import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type AgentTool, type Model, type StreamFn, Type } from "@milu/core";

import { createMemoryAgent } from "./agent.ts";
import { type PassOutcome, runRalphLoop } from "./loop.ts";
import { appendMemoryRun, ensureMemoryDir, type MemoryRecord, memoryDir, type MemoryRunLog, type MemoryRunReason, readMemoryLines } from "./store.ts";

export interface SceneRevision {
	id: string;
	createdAt: number;
	kind: "revision";
	sceneId: string;
	op: "upsert" | "delete";
	name: string;
	summary: string;
	content: string;
	heat: number;
	sourceMemoryIds: string[];
	mergedFrom?: string[];
}

export interface SceneCheckpoint {
	id: string;
	createdAt: number;
	kind: "checkpoint";
	throughMemoryId: string;
}

export type SceneLine = SceneRevision | SceneCheckpoint;

export interface SceneState {
	sceneId: string;
	name: string;
	summary: string;
	content: string;
	heat: number;
	createdAt: number;
	updatedAt: number;
	sourceMemoryIds: string[];
	mergedFrom?: string[];
}

export interface ScenePendingBatch {
	records: MemoryRecord[];
	throughId: string | null;
	total: number;
}

export const MEMORY_SCENE_BATCH = 10;
export const DEFAULT_MAX_SCENES = 15;
const MAX_SCENE_NAME = 80;
const MAX_SCENE_SUMMARY = 120;
const MAX_SCENE_CONTENT = 1500;
const MAX_SCENE_SOURCE_IDS = 50;
const MAX_SCENE_BATCH_SIZE = 40;

interface SceneSection {
	title: string;
	rule: string;
	mayBeEmpty: boolean;
	prose?: boolean;
	maxChars?: number;
	sequence?: string[];
}

const SCENE_SECTIONS: SceneSection[] = [
	{ title: "User Basics", rule: "may be empty; add whatever fields you need — on a conflict overwrite the old value", mayBeEmpty: true },
	{ title: "Core Traits", rule: "connected prose, never a list, at most 100 characters", mayBeEmpty: false, prose: true, maxChars: 100 },
	{ title: "Preferences", rule: "may be empty; a list is fine here", mayBeEmpty: true },
	{ title: "Implicit Signals", rule: "inferred only, may be empty — better empty than speculative", mayBeEmpty: true },
	{
		title: "Core Narrative",
		rule: "connected prose, never a list, at most 400 characters, and it must read Trigger → Action → Result",
		mayBeEmpty: false,
		prose: true,
		maxChars: 400,
		sequence: ["Trigger", "Action", "Result"],
	},
	{ title: "Evolution", rule: "may be empty; only major shifts, and a conflict is recorded as a change of mind instead of overwriting it", mayBeEmpty: true },
	{ title: "Open Questions", rule: "may be empty", mayBeEmpty: true },
];

const headingPattern = (title: string) => new RegExp(`^#{1,6}\\s*${title}\\s*$`, "m");

function formatProblems(content: string): string[] {
	const problems: string[] = [];
	const titles = SCENE_SECTIONS.map((section) => section.title);
	const bodies = new Map<string, string>();
	let previous = -1;
	for (const title of titles) {
		const match = headingPattern(title).exec(content);
		if (!match) {
			problems.push(`missing heading "## ${title}"`);
			continue;
		}
		if (match.index < previous) problems.push(`heading "## ${title}" is out of order`);
		previous = match.index;
		const rest = content.slice(match.index + match[0].length);
		const next = /^#{1,6}\s/m.exec(rest);
		bodies.set(title, (next ? rest.slice(0, next.index) : rest).trim());
	}
	const extra = [...content.matchAll(/^#{1,6}\s*(.+?)\s*$/gm)].map((match) => match[1]!).filter((title) => !titles.includes(title));
	for (const title of new Set(extra)) problems.push(`unknown heading "${title}" — the document carries only the fixed sections`);
	for (const section of SCENE_SECTIONS) {
		const body = bodies.get(section.title) ?? "";
		if (!body) {
			if (!section.mayBeEmpty) problems.push(`"## ${section.title}" cannot be empty`);
			continue;
		}
		if (section.prose && /^\s*([-*+]|\d+[.)])\s+\S/.test(body)) problems.push(`"## ${section.title}" must be connected prose, not a list`);
		if (section.maxChars && body.length > section.maxChars) problems.push(`"## ${section.title}" is ${body.length} characters (max ${section.maxChars})`);
		if (section.sequence) {
			const at = section.sequence.map((word) => body.indexOf(word));
			if (at.some((index) => index < 0) || at.some((index, i) => i > 0 && index < at[i - 1]!)) problems.push(`"## ${section.title}" must read ${section.sequence.join(" → ")}`);
		}
	}
	return problems;
}

export const scenesFilePath = (dir: string) => join(memoryDir(dir), "scenes.jsonl");
export const sceneViewsDir = (dir: string) => join(memoryDir(dir), "views", "scenes");
export const sceneNavigationPath = (dir: string) => join(memoryDir(dir), "views", "navigation.txt");

export async function ensureSceneFile(dir: string): Promise<void> {
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(scenesFilePath(dir), "", "utf8");
}

export async function readSceneLines(dir: string): Promise<SceneLine[]> {
	try {
		const raw = await readFile(scenesFilePath(dir), "utf8");
		const out: SceneLine[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as SceneLine;
				if (parsed && typeof parsed.id === "string" && typeof parsed.kind === "string") out.push(parsed);
			} catch {}
		}
		return out;
	} catch {
		return [];
	}
}

export async function appendSceneLines(dir: string, lines: SceneLine[]): Promise<void> {
	if (lines.length === 0) return;
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(scenesFilePath(dir), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
}

export function sceneSlug(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^[-._]+|[-._]+$/g, "");
	return slug && !/^\.+$/.test(slug) ? slug : `scene-${randomUUID().slice(0, 8)}`;
}

export function foldScenes(lines: SceneLine[]): SceneState[] {
	const byId = new Map<string, { created: number; latest: SceneRevision }>();
	for (const line of lines) {
		if (line.kind !== "revision") continue;
		const existing = byId.get(line.sceneId);
		if (existing) existing.latest = line;
		else byId.set(line.sceneId, { created: line.createdAt, latest: line });
	}
	const out: SceneState[] = [];
	for (const [sceneId, entry] of byId) {
		const revision = entry.latest;
		if (revision.op === "delete") continue;
		out.push({
			sceneId,
			name: revision.name,
			summary: revision.summary,
			content: revision.content,
			heat: revision.heat,
			createdAt: entry.created,
			updatedAt: revision.createdAt,
			sourceMemoryIds: revision.sourceMemoryIds,
			...(revision.mergedFrom ? { mergedFrom: revision.mergedFrom } : {}),
		});
	}
	return out.sort((a, b) => b.heat - a.heat || a.name.localeCompare(b.name));
}

export function changedScenes(lines: SceneLine[], throughRevId: string | null): SceneState[] {
	const cursor = throughRevId ? lines.findIndex((line) => line.id === throughRevId) : -1;
	const changedIds = new Set<string>();
	for (let i = Math.max(0, cursor + 1); i < lines.length; i++) {
		const line = lines[i];
		if (line.kind === "revision") changedIds.add(line.sceneId);
	}
	if (changedIds.size === 0) return [];
	const active = new Map(foldScenes(lines).map((scene) => [scene.sceneId, scene]));
	return [...changedIds].map((id) => active.get(id)).filter((scene): scene is SceneState => scene !== undefined);
}

export async function scenePendingBatch(dir: string, limit = MAX_SCENE_BATCH_SIZE): Promise<ScenePendingBatch> {
	const sceneLines = await readSceneLines(dir);
	const checkpoint = [...sceneLines].reverse().find((line): line is SceneCheckpoint => line.kind === "checkpoint");
	const memoryRecords = (await readMemoryLines(dir)).filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	let start = 0;
	if (checkpoint) {
		const index = memoryRecords.findIndex((record) => record.id === checkpoint.throughMemoryId);
		if (index >= 0) start = index + 1;
	}
	const pending = memoryRecords.slice(start);
	const records = pending.slice(0, Math.max(1, limit));
	return { records, throughId: records.at(-1)?.id ?? null, total: pending.length };
}

export async function scenePendingCount(dir: string): Promise<number> {
	return (await scenePendingBatch(dir, 1)).total;
}

const sceneWorkflow = (maxScenes: number): string => `You maintain long-lived scene documents distilled from this partner's atomic memories.

Every document carries this fixed skeleton — these headings, in this order, and nothing else. A section you have nothing for stays as a bare heading.
${SCENE_SECTIONS.map((section) => `## ${section.title}\n  ${section.rule}`).join("\n")}

Tools: one tool, "scene", with an op.
- read: fetch a scene document (pass sceneId), or list the active scenes (omit sceneId). Read a scene before you edit it.
- create: a new scene. Last resort, at most one per run, at most ${maxScenes} scenes in total.
- edit: replace an exact oldString inside an existing scene with newString. Copy the snippet you want to change verbatim from a read.
- There is no delete op; removing a scene is a manual, out-of-band action.

Strategy (in priority order):
1. EDIT (default): if the new memories fit an existing scene, read it and edit it so it stays coherent.
2. MERGE: when scenes overlap or tell one story, create one scene that supersedes them all and list their ids in mergeSceneIds — the engine writes the new document and deletes the absorbed scenes in the same run. Absorbing scenes into an existing one is not possible: the merged document is always a new scene, and it uses this run's single create.
3. CREATE: only when no existing scene fits.

Rules:
- content: the skeleton above, at most ${MAX_SCENE_CONTENT} characters in total; aim for 500-900. Summarize; never copy memory text verbatim.
- The engine rejects a write that breaks the skeleton or the limit and tells you exactly what is wrong. A document written before this skeleton existed is converted by replacing its whole body in one edit (or by create).
- summary: one line, at most ${MAX_SCENE_SUMMARY} characters; it is the navigation index entry.
- name: a short human-readable title; keep it stable when editing (scene ids identify documents, not names).
- sourceMemoryIds: the ids of the new memories this write actually incorporates, chosen from the batch. The checkpoint only advances past the batch entries you list here, so never list a memory you did not use.
- Never invent facts that are not present in the memories or the current scenes.
- Anything you leave out stays pending and comes back in the next run.`;

const sceneSchema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("create"), Type.Literal("edit")], {
		description: "read: fetch a scene (or list them); create: a new scene; edit: replace oldString with newString inside an existing scene",
	}),
	sceneId: Type.Optional(Type.String({ description: 'Target scene id. Required for "edit"; optional for "read" (omitting it lists the active scenes)' })),
	name: Type.Optional(Type.String({ description: "create: short human-readable title" })),
	summary: Type.Optional(Type.String({ description: `create/edit: one-line navigation summary (max ${MAX_SCENE_SUMMARY} chars)` })),
	content: Type.Optional(Type.String({ description: `create: the full markdown document — the fixed skeleton (max ${MAX_SCENE_CONTENT} chars)` })),
	oldString: Type.Optional(Type.String({ description: "edit: exact text to replace, copied from a read; must appear exactly once" })),
	newString: Type.Optional(Type.String({ description: "edit: replacement text (empty string removes the match)" })),
	sourceMemoryIds: Type.Optional(Type.Array(Type.String({ description: "Ids of the new memories this write incorporates, from the batch you were given" }))),
	mergeSceneIds: Type.Optional(Type.Array(Type.String({ description: "create only: active scene ids this new scene replaces; the engine deletes them in the same run" }))),
});

function isoDay(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function tooLong(length: number, limit: number): string | null {
	if (length <= limit) return null;
	return `content is ${length} characters, ${length - limit} over the ${limit}-character limit. Merge or drop whole blocks that repeat each other (the same decision stated twice, one-off details, narration) instead of rewording, then write again.`;
}

function formatProblem(content: string): string | null {
	const problems = formatProblems(content);
	return problems.length > 0 ? problems.join("; ") : null;
}

export interface SceneRunState {
	scenes: SceneState[];
	newScenes: number;
	totalRevisions: number;
	coveredIds: Set<string>;
}

export interface SceneToolDeps {
	dir: string;
	state: SceneRunState;
	batchIds: Set<string>;
	maxScenes: number;
}

export function createSceneTool(deps: SceneToolDeps): AgentTool<typeof sceneSchema, { ok: boolean; error?: string }> {
	return {
		name: "scene",
		label: "Scene",
		description:
			"Read, create or edit this partner's scene documents. read: fetch a scene or list them; create: one new scene per run; edit: replace an exact oldString inside a scene. No delete op.",
		parameters: sceneSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `scene rejected: ${message}` }], details: { ok: false, error: message } });
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });
			const sceneId = params.sceneId?.trim() ?? "";

			if (params.op === "read") {
				if (deps.state.scenes.length === 0) return note("No scenes yet — use op create.");
				if (!sceneId) {
					return note(
						deps.state.scenes
							.map(
								(scene) =>
									`### ${scene.sceneId} — ${scene.name} (heat ${scene.heat}, updated ${isoDay(scene.updatedAt)}, ${scene.sourceMemoryIds.length} memories)\nSummary: ${scene.summary}`,
							)
							.join("\n\n"),
					);
				}
				const scene = deps.state.scenes.find((candidate) => candidate.sceneId === sceneId);
				if (!scene) return reject(`unknown sceneId "${sceneId}" — call op read without sceneId to list the active scenes`);
				const sources = scene.sourceMemoryIds.join(", ") || "(none)";
				return note(
					`### ${scene.sceneId} — ${scene.name}\nheat ${scene.heat} · updated ${isoDay(scene.updatedAt)}\nSummary: ${scene.summary}\nSource memories: ${sources}\n\n${scene.content}`,
				);
			}

			const sourceMemoryIds = [...new Set((params.sourceMemoryIds ?? []).filter((id) => deps.batchIds.has(id)))].slice(0, MAX_SCENE_SOURCE_IDS);
			if (sourceMemoryIds.length === 0) return reject("sourceMemoryIds must reference memories from the batch you were given");

			if (params.op === "edit") {
				const existing = deps.state.scenes.find((candidate) => candidate.sceneId === sceneId);
				if (!existing) return reject(`unknown sceneId "${sceneId}"; use op "create" for a new scene (op "read" lists them)`);
				if (params.mergeSceneIds?.length) return reject("mergeSceneIds is only valid with op create");
				const oldString = params.oldString ?? "";
				if (!oldString) return reject("edit needs oldString: the exact text to replace, copied verbatim from a read");
				const at = existing.content.indexOf(oldString);
				if (at < 0) return reject("oldString was not found in the current content — read the scene first and copy the snippet exactly");
				if (existing.content.indexOf(oldString, at + oldString.length) >= 0)
					return reject("oldString matches more than once — include more surrounding text so the match is unique");
				const content = existing.content.slice(0, at) + (params.newString ?? "") + existing.content.slice(at + oldString.length);
				const summary = (params.summary ?? existing.summary).replace(/\s+/g, " ").trim();
				if (!summary) return reject("summary cannot be empty");
				if (summary.length > MAX_SCENE_SUMMARY) return reject(`summary is ${summary.length} characters (max ${MAX_SCENE_SUMMARY})`);
				const overflow = tooLong(content.length, MAX_SCENE_CONTENT);
				if (overflow) return reject(overflow);
				const formatIssue = formatProblem(content);
				if (formatIssue) return reject(formatIssue);

				const revision: SceneRevision = {
					id: `rev-${randomUUID()}`,
					createdAt: Date.now(),
					kind: "revision",
					sceneId: existing.sceneId,
					op: "upsert",
					name: existing.name,
					summary,
					content,
					heat: existing.heat + 1,
					sourceMemoryIds: [...new Set([...existing.sourceMemoryIds, ...sourceMemoryIds])].slice(0, MAX_SCENE_SOURCE_IDS),
				};
				await appendSceneLines(deps.dir, [revision]);
				deps.state.totalRevisions += 1;
				deps.state.scenes = deps.state.scenes.map((scene) =>
					scene.sceneId === existing.sceneId
						? { ...scene, summary, content, heat: scene.heat + 1, updatedAt: revision.createdAt, sourceMemoryIds: revision.sourceMemoryIds }
						: scene,
				);
				for (const id of sourceMemoryIds) deps.state.coveredIds.add(id);
				return note(`scene ${existing.sceneId} edited (heat ${existing.heat + 1})`);
			}

			const name = (params.name ?? "").replace(/\s+/g, " ").trim();
			const summary = (params.summary ?? "").replace(/\s+/g, " ").trim();
			const content = (params.content ?? "").trim();
			if (!name) return reject("create needs name");
			if (name.length > MAX_SCENE_NAME) return reject(`name is ${name.length} characters (max ${MAX_SCENE_NAME})`);
			if (!summary) return reject("create needs summary (one line, max 120 characters)");
			if (summary.length > MAX_SCENE_SUMMARY) return reject(`summary is ${summary.length} characters (max ${MAX_SCENE_SUMMARY})`);
			if (!content) return reject("create needs content (the full markdown document)");
			const overflow = tooLong(content.length, MAX_SCENE_CONTENT);
			if (overflow) return reject(overflow);
			const formatIssue = formatProblem(content);
			if (formatIssue) return reject(formatIssue);
			if (deps.state.newScenes >= 1) return reject("only one new scene per run — edit an existing scene, or leave the rest of the batch for the next run (it stays pending)");
			if (deps.state.scenes.length >= deps.maxScenes) return reject(`scene limit (${deps.maxScenes}) reached; merge existing scenes first`);
			const newSceneId = sceneSlug(name);
			if (deps.state.scenes.some((scene) => scene.sceneId === newSceneId)) return reject(`scene "${newSceneId}" already exists; use op "edit"`);
			const mergeSceneIds = [...new Set(params.mergeSceneIds ?? [])].filter((id) => id !== newSceneId);
			const absorbed: SceneState[] = [];
			for (const id of mergeSceneIds) {
				const target = deps.state.scenes.find((scene) => scene.sceneId === id);
				if (!target) return reject(`merge target "${id}" is not an active scene`);
				absorbed.push(target);
			}
			const createdAt = Date.now();
			const heat = absorbed.length ? absorbed.reduce((total, scene) => total + scene.heat, 0) + 1 : 1;
			const revision: SceneRevision = {
				id: `rev-${randomUUID()}`,
				createdAt,
				kind: "revision",
				sceneId: newSceneId,
				op: "upsert",
				name,
				summary,
				content,
				heat,
				sourceMemoryIds,
				...(mergeSceneIds.length ? { mergedFrom: mergeSceneIds } : {}),
			};
			const deletions: SceneRevision[] = absorbed.map((scene) => ({
				id: `rev-${randomUUID()}`,
				createdAt,
				kind: "revision" as const,
				sceneId: scene.sceneId,
				op: "delete" as const,
				name: scene.name,
				summary: "",
				content: "",
				heat: scene.heat,
				sourceMemoryIds: [],
			}));
			await appendSceneLines(deps.dir, [revision, ...deletions]);
			deps.state.totalRevisions += 1 + deletions.length;
			deps.state.newScenes += 1;
			const created: SceneState = {
				sceneId: newSceneId,
				name,
				summary,
				content,
				heat,
				createdAt,
				updatedAt: createdAt,
				sourceMemoryIds,
				...(mergeSceneIds.length ? { mergedFrom: mergeSceneIds } : {}),
			};
			deps.state.scenes = deps.state.scenes.filter((scene) => !mergeSceneIds.includes(scene.sceneId)).concat(created);
			for (const id of sourceMemoryIds) deps.state.coveredIds.add(id);
			const merged = mergeSceneIds.length ? ` (merged ${mergeSceneIds.join(", ")} · heat ${heat})` : "";
			return note(`scene ${newSceneId} created${merged}`);
		},
	};
}

export function coveredPrefixLength(records: MemoryRecord[], covered: Set<string>): number {
	let length = 0;
	for (const record of records) {
		if (!covered.has(record.id)) break;
		length += 1;
	}
	return length;
}

function scenePrompt(scenes: SceneState[], batch: ScenePendingBatch, reason: "threshold" | "manual", maxScenes: number): string {
	const lines: string[] = [];
	lines.push(reason === "manual" ? "A manual scene pass was requested." : "A scheduled scene pass is running.");
	lines.push("");
	lines.push(`Active scenes (${scenes.length}/${maxScenes}) — call scene op "read" for a scene's full document:`);
	lines.push(
		scenes.length
			? scenes
					.map(
						(scene) =>
							`### ${scene.sceneId} — ${scene.name} (heat ${scene.heat}, updated ${isoDay(scene.updatedAt)}, ${scene.sourceMemoryIds.length} memories)\nSummary: ${scene.summary}`,
					)
					.join("\n\n")
			: "(none yet)",
	);
	lines.push("");
	lines.push(`New memories (${batch.records.length}${batch.total > batch.records.length ? ` of ${batch.total} pending` : ""}):`);
	lines.push(
		batch.records
			.map(
				(record) =>
					`- [${record.id}] ${record.kind}${record.scene ? ` (scene: ${record.scene})` : ""}: ${record.data.summary}${record.data.detail ? `\n  ${record.data.detail.slice(0, 400)}` : ""}`,
			)
			.join("\n"),
	);
	if (scenes.length >= maxScenes) lines.push("", `WARNING: the scene limit (${maxScenes}) is reached — you MUST merge existing scenes; create is rejected.`);
	else if (scenes.length === maxScenes - 1) lines.push("", `WARNING: near the scene limit (${maxScenes}) — prefer edit or merge; create only for a genuinely new theme.`);
	lines.push("", "Work this batch.");
	return lines.join("\n");
}

export interface OrganizeScenesOptions {
	dir: string;
	model: Model<any>;
	streamFn: StreamFn;
	signal?: AbortSignal;
	reason: "threshold" | "manual";
	maxScenes?: number;
	logRun?: MemoryRunLog;
}

export async function organizeScenes(opts: OrganizeScenesOptions): Promise<number> {
	await ensureSceneFile(opts.dir);
	const batch = await scenePendingBatch(opts.dir);
	if (batch.records.length === 0 || !batch.throughId) return 0;
	const model = opts.model;

	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	const checkpoints: string[] = [];
	const maxScenes = opts.maxScenes && opts.maxScenes > 0 ? opts.maxScenes : DEFAULT_MAX_SCENES;
	const state: SceneRunState = { scenes: foldScenes(await readSceneLines(opts.dir)), newScenes: 0, totalRevisions: 0, coveredIds: new Set() };
	let coveredThroughId: string | null = null;
	const batchIds = new Set(batch.records.map((record) => record.id));
	let attempts = 0;
	let added = 0;

	if (opts.logRun) {
		try {
			await opts.logRun.start({ runId, stage: "scene", startedAt });
		} catch (error) {
			console.error("scene run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunReason, error?: string) {
		const endedAt = Date.now();
		try {
			await opts.logRun?.end({ runId, stage: "scene", startedAt, endedAt, reason, added });
		} catch (logError) {
			console.error("scene run end log failed:", logError);
		}
		try {
			await appendMemoryRun(opts.dir, {
				runId,
				stage: "scene",
				model: `${model.provider}/${model.id ?? "default"}`,
				startedAt,
				endedAt,
				durationMs: endedAt - startedAt,
				reason,
				attempts,
				added,
				targetRawId: null,
				cursorRawId: null,
				...(coveredThroughId ? { throughMemoryId: coveredThroughId } : {}),
				...(error ? { error } : {}),
				...(checkpoints.length ? { checkpoints } : {}),
			});
		} catch (runError) {
			console.error("scene run append failed:", runError);
		}
	}

	try {
		const loop = await runRalphLoop({
			maxAttempts: 1,
			signal: opts.signal,
			createPass: () => ({
				agent: createMemoryAgent(model, opts.streamFn, sceneWorkflow(maxScenes), [createSceneTool({ dir: opts.dir, state, batchIds, maxScenes })]),
				prompt: scenePrompt(state.scenes, batch, opts.reason, maxScenes),
			}),
			settlePass: async (): Promise<PassOutcome> => {
				const covered = coveredPrefixLength(batch.records, state.coveredIds);
				if (covered === 0) return "stalled";
				coveredThroughId = batch.records[covered - 1]!.id;
				await appendSceneLines(opts.dir, [{ id: `chk-${randomUUID()}`, createdAt: Date.now(), kind: "checkpoint", throughMemoryId: coveredThroughId }]);
				checkpoints.push(coveredThroughId);
				return "done";
			},
		});
		attempts = loop.attempts;
		added = state.totalRevisions;
		await rebuildSceneViews(opts.dir);
		await endRun(loop.reason);
		return added;
	} catch (error) {
		added = state.totalRevisions;
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	}
}

export function sceneNavigationBlock(dir: string, scenes: SceneState[]): string {
	const index = scenes.map(
		(scene) =>
			`### Path: ${join(sceneViewsDir(dir), `${scene.sceneId}.md`)}\n**name**: ${scene.name} | **heat**: ${scene.heat} | **updated**: ${isoDay(scene.updatedAt)}\nSummary: ${scene.summary}`,
	);
	return ["<scene-navigation>", "Long-term scene memory index. Use the read tool on a path below when a scene looks relevant.", "", ...index, "</scene-navigation>"].join("\n");
}

export async function currentSceneNavigation(dir: string): Promise<string> {
	const scenes = foldScenes(await readSceneLines(dir));
	return scenes.length ? sceneNavigationBlock(dir, scenes) : "";
}

export async function rebuildSceneViews(dir: string): Promise<void> {
	if (!(await ensureMemoryDir(dir))) return;
	const scenes = foldScenes(await readSceneLines(dir));
	const viewsDir = sceneViewsDir(dir);
	await rm(viewsDir, { recursive: true, force: true });
	await mkdir(viewsDir, { recursive: true });
	const navigation = sceneNavigationPath(dir);
	if (scenes.length === 0) {
		await rm(navigation, { force: true });
		return;
	}
	for (const scene of scenes) {
		const body = [
			"-----META-START-----",
			`scene: ${scene.sceneId}`,
			`name: ${scene.name}`,
			`created: ${isoDay(scene.createdAt)}`,
			`updated: ${isoDay(scene.updatedAt)}`,
			`heat: ${scene.heat}`,
			`summary: ${scene.summary}`,
			"-----META-END-----",
			"",
			scene.content,
			"",
		].join("\n");
		await writeFile(join(viewsDir, `${scene.sceneId}.md`), body, "utf8");
	}
	await writeFile(navigation, `${sceneNavigationBlock(dir, scenes)}\n`, "utf8");
}
