import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { type Model, Type } from "@earendil-works/pi-ai";
import type { MemoryRunEndReason } from "../persist/events";
import { convertToLlm, STREAM_FN } from "./agent-config";
import {
	addMessageUsage,
	appendMemoryRun,
	emptyMemoryUsage,
	ensureMemoryDir,
	type MemoryRecord,
	type MemoryTrajectoryAttempt,
	memoryDir,
	type OrganizeMemoryOptions,
	readMemoryLines,
	snapshotTrajectory,
} from "./memory";
import { runRalphLoop } from "./ralph-loop";
import { changedScenes, foldScenes, readSceneLines, type SceneRevision, type SceneState } from "./scenes";

export interface PersonaVersion {
	id: string;
	createdAt: number;
	kind: "persona";
	version: number;
	content: string;
	sourceSceneIds: string[];
	throughSceneRevId: string;
	throughMemoryId: string;
	reason: "bootstrap" | "threshold" | "explicit" | "manual";
}

export const PERSONA_EVERY_N = 50;
export const MAX_PERSONA_CONTENT = 2000;
const PERSONA_SECTIONS = ["Basic Anchors", "Interest Map", "Interaction Protocol", "Cognitive Core"];

export const personaFilePath = (dir: string) => join(memoryDir(dir), "persona.jsonl");
export const personaViewPath = (dir: string) => join(memoryDir(dir), "views", "persona.md");

export async function ensurePersonaFile(dir: string): Promise<void> {
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(personaFilePath(dir), "", "utf8");
}

export async function readPersonaLines(dir: string): Promise<PersonaVersion[]> {
	try {
		const raw = await readFile(personaFilePath(dir), "utf8");
		const out: PersonaVersion[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as PersonaVersion;
				if (parsed && typeof parsed.id === "string" && parsed.kind === "persona") out.push(parsed);
			} catch {}
		}
		return out;
	} catch {
		return [];
	}
}

export async function appendPersonaLines(dir: string, versions: PersonaVersion[]): Promise<void> {
	if (versions.length === 0) return;
	if (!(await ensureMemoryDir(dir))) return;
	await appendFile(personaFilePath(dir), versions.map((version) => JSON.stringify(version)).join("\n") + "\n", "utf8");
}

export function latestPersona(versions: PersonaVersion[]): PersonaVersion | null {
	let latest: PersonaVersion | null = null;
	for (const version of versions) {
		if (!latest || version.version >= latest.version) latest = version;
	}
	return latest;
}

export interface PersonaTrigger {
	run: boolean;
	reason: "bootstrap" | "threshold" | "explicit" | null;
	newMemories: MemoryRecord[];
	changedScenes: SceneState[];
}

export async function personaTrigger(dir: string): Promise<PersonaTrigger> {
	const sceneLines = await readSceneLines(dir);
	const active = foldScenes(sceneLines);
	if (active.length === 0) return { run: false, reason: null, newMemories: [], changedScenes: [] };
	const last = latestPersona(await readPersonaLines(dir));
	const memories = (await readMemoryLines(dir)).filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	if (!last) return { run: true, reason: "bootstrap", newMemories: memories, changedScenes: active };
	const newMemories = memoriesSince(memories, last);
	const changed = changedScenes(sceneLines, last.throughSceneRevId);
	if (newMemories.some((memory) => memory.remember === true)) return { run: true, reason: "explicit", newMemories, changedScenes: changed };
	if (newMemories.length >= PERSONA_EVERY_N) return { run: true, reason: "threshold", newMemories, changedScenes: changed };
	return { run: false, reason: null, newMemories, changedScenes: changed };
}

function memoriesSince(memories: MemoryRecord[], last: PersonaVersion): MemoryRecord[] {
	const index = memories.findIndex((memory) => memory.id === last.throughMemoryId);
	if (index >= 0) return memories.slice(index + 1);
	return memories.filter((memory) => memory.createdAt > last.createdAt);
}

export async function rebuildPersonaView(dir: string): Promise<void> {
	const last = latestPersona(await readPersonaLines(dir));
	const path = personaViewPath(dir);
	if (!last) {
		await rm(path, { force: true });
		return;
	}
	if (!(await ensureMemoryDir(dir))) return;
	await mkdir(join(memoryDir(dir), "views"), { recursive: true });
	await writeFile(path, `<!-- generated from persona.jsonl v${last.version} · ${new Date(last.createdAt).toISOString().slice(0, 10)} -->\n\n${last.content}\n`, "utf8");
}

const PERSONA_WORKFLOW = `You maintain a single long-term profile (persona) for this partner, distilled only from its scene documents.

Tools: one tool, "persona", with an op.
- read: fetch the current persona document. Read before you edit.
- create: write the complete document in one call — the first version, or a full restructure. At most one create per run.
- edit: replace an exact oldString inside the current document with newString. Copy the snippet verbatim from a read. This is the default for incremental updates: whatever you do not touch stays byte-identical.

Rules:
- The document must stay at most ${MAX_PERSONA_CONTENT} characters.
- It must carry these exact section headings, in this order:
${PERSONA_SECTIONS.map((section) => `  ## ${section}`).join("\n")}
  If the current document uses other headings, replace them with these in this run: one edit that replaces the whole body, or create.
- Only include what the scenes support. Never speculate, never invent, and never use information from outside the scenes.
- sourceSceneIds must list the active scene ids this write actually draws from, chosen from the scenes you were given.`;

const personaSchema = Type.Object({
	op: Type.Union([Type.Literal("read"), Type.Literal("create"), Type.Literal("edit")], {
		description: "read: fetch the current persona; create: the complete document (once per run); edit: replace oldString with newString inside the current document",
	}),
	content: Type.Optional(Type.String({ description: `create: the full persona document (max ${MAX_PERSONA_CONTENT} chars) with the required section headings` })),
	oldString: Type.Optional(Type.String({ description: "edit: exact text to replace, copied from a read; must appear exactly once" })),
	newString: Type.Optional(Type.String({ description: "edit: replacement text (empty string removes the match)" })),
	sourceSceneIds: Type.Optional(Type.Array(Type.String({ description: "Active scene ids this write draws from" }))),
});

function formatProblem(content: string): string | null {
	const pattern = (section: string) => new RegExp(`^#{1,6}\\s*${section}\\s*$`, "m");
	const missing = PERSONA_SECTIONS.filter((section) => !pattern(section).test(content));
	if (missing.length > 0) return `missing required section headings: ${missing.join(" / ")} (use "## <title>" lines)`;
	const at = PERSONA_SECTIONS.map((section) => content.search(pattern(section)));
	if (at.some((index, i) => i > 0 && index < at[i - 1]!)) return `required section headings are out of order: ${PERSONA_SECTIONS.join(" → ")}`;
	return null;
}

export interface PersonaRunState {
	content: string;
	version: number;
	sourceSceneIds: string[];
	created: boolean;
	writes: number;
}

export interface PersonaToolDeps {
	dir: string;
	state: PersonaRunState;
	activeIds: Set<string>;
	throughSceneRevId: string;
	throughMemoryId: string;
	reason: PersonaVersion["reason"];
}

export function createPersonaTool(deps: PersonaToolDeps): AgentTool<typeof personaSchema, { ok: boolean; error?: string }> {
	return {
		name: "persona",
		label: "Persona",
		description:
			"Read, create or edit this partner's persona document. read: fetch the current document; create: the complete document, once per run; edit: replace an exact oldString inside the current document.",
		parameters: personaSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const reject = (message: string) => ({ content: [{ type: "text" as const, text: `persona rejected: ${message}` }], details: { ok: false, error: message } });
			const note = (text: string) => ({ content: [{ type: "text" as const, text }], details: { ok: true } });
			const { state } = deps;

			if (params.op === "read") {
				if (!state.content) return note("No persona yet — use op create.");
				return note(`### persona v${state.version}\nSource scenes: ${state.sourceSceneIds.join(", ") || "(none)"}\n\n${state.content}`);
			}

			const sourceSceneIds = [...new Set((params.sourceSceneIds ?? []).filter((id) => deps.activeIds.has(id)))];
			if (sourceSceneIds.length === 0) return reject("sourceSceneIds must reference active scenes from the list you were given");

			let content: string;
			let mergedIds: string[];
			if (params.op === "edit") {
				if (!state.content) return reject('no persona yet — use op "create" for the first version');
				const oldString = params.oldString ?? "";
				if (!oldString) return reject("edit needs oldString: the exact text to replace, copied verbatim from a read");
				const at = state.content.indexOf(oldString);
				if (at < 0) return reject("oldString was not found in the current document — read the persona first and copy the snippet exactly");
				if (state.content.indexOf(oldString, at + oldString.length) >= 0) return reject("oldString matches more than once — include more surrounding text so the match is unique");
				content = state.content.slice(0, at) + (params.newString ?? "") + state.content.slice(at + oldString.length);
				mergedIds = [...new Set([...state.sourceSceneIds, ...sourceSceneIds])];
			} else {
				if (state.created) return reject("only one create per run — use op edit for the remaining changes");
				content = (params.content ?? "").trim();
				if (!content) return reject("create needs content (the full document)");
				mergedIds = sourceSceneIds;
			}
			if (content.length > MAX_PERSONA_CONTENT) {
				return reject(
					`the document would be ${content.length} characters, ${content.length - MAX_PERSONA_CONTENT} over the ${MAX_PERSONA_CONTENT}-character limit — summarize instead of listing, and drop whole clauses that repeat each other.`,
				);
			}
			const formatIssue = formatProblem(content);
			if (formatIssue) return reject(formatIssue);

			const version: PersonaVersion = {
				id: `persona-${randomUUID()}`,
				createdAt: Date.now(),
				kind: "persona",
				version: state.version + 1,
				content,
				sourceSceneIds: mergedIds,
				throughSceneRevId: deps.throughSceneRevId,
				throughMemoryId: deps.throughMemoryId,
				reason: deps.reason,
			};
			await appendPersonaLines(deps.dir, [version]);
			state.content = content;
			state.version = version.version;
			state.sourceSceneIds = mergedIds;
			state.writes += 1;
			if (params.op === "create") state.created = true;
			return note(`persona v${version.version} ${params.op === "create" ? "created" : "edited"}`);
		},
	};
}

function personaPrompt(last: PersonaVersion | null, scenes: SceneState[], reason: OrganizePersonaOptions["reason"]): string {
	const lines: string[] = [];
	lines.push(reason === "manual" ? "A manual profile update was requested." : "A scheduled profile update is running.");
	lines.push("");
	lines.push("Current persona:");
	lines.push(last ? last.content : "(none yet)");
	lines.push("");
	lines.push("Scenes to incorporate:");
	lines.push(scenes.map((scene) => `### ${scene.sceneId} — ${scene.name}\nSummary: ${scene.summary}\n${scene.content}`).join("\n\n"));
	lines.push("");
	lines.push(
		`Update the persona document (at most ${MAX_PERSONA_CONTENT} characters) so it reflects these scenes. Required section headings, in this order: ${PERSONA_SECTIONS.map((section) => `## ${section}`).join(" / ")}.`,
	);
	lines.push('Prefer op "edit" for targeted changes; "create" writes the whole document and is allowed once per run.');
	lines.push("Only write what the scenes support — never speculate.");
	return lines.join("\n");
}

export interface OrganizePersonaOptions {
	dir: string;
	model: Model<any>;
	signal?: AbortSignal;
	logRun?: NonNullable<OrganizeMemoryOptions["logRun"]>;
	reason: "bootstrap" | "threshold" | "explicit" | "manual";
	force?: boolean;
}

export async function organizePersona(opts: OrganizePersonaOptions): Promise<number> {
	await ensurePersonaFile(opts.dir);
	const sceneLines = await readSceneLines(opts.dir);
	const active = foldScenes(sceneLines);
	if (active.length === 0) return 0;
	const last = latestPersona(await readPersonaLines(opts.dir));
	const scenes = opts.force || !last ? active : changedScenes(sceneLines, last.throughSceneRevId);
	if (scenes.length === 0 && !opts.force) return 0;
	const inputScenes = scenes.length > 0 ? scenes : active;
	const activeIds = new Set(active.map((scene) => scene.sceneId));
	const throughSceneRevId = [...sceneLines].reverse().find((line): line is SceneRevision => line.kind === "revision")?.id ?? "";
	const memories = (await readMemoryLines(opts.dir)).filter((line): line is MemoryRecord => line.kind !== "checkpoint");
	const throughMemoryId = memories.at(-1)?.id ?? last?.throughMemoryId ?? "";

	const model = opts.model;
	const runId = `run-${randomUUID()}`;
	const startedAt = Date.now();
	const trajectory: MemoryTrajectoryAttempt[] = [];
	const usage = emptyMemoryUsage();
	const state: PersonaRunState = { content: last?.content ?? "", version: last?.version ?? 0, sourceSceneIds: last?.sourceSceneIds ?? [], created: false, writes: 0 };
	const logStart = opts.logRun?.start;
	const logEnd = opts.logRun?.end;
	let attempts = 0;
	let added = 0;

	if (logStart) {
		try {
			await logStart({ runId, stage: "persona", startedAt });
		} catch (error) {
			console.error("persona run start log failed:", error);
		}
	}

	async function endRun(reason: MemoryRunEndReason, error?: string) {
		const endedAt = Date.now();
		if (logEnd) {
			try {
				await logEnd({ runId, stage: "persona", startedAt, endedAt, reason, added });
			} catch (logError) {
				console.error("persona run end log failed:", logError);
			}
		}
		try {
			await appendMemoryRun(opts.dir, {
				runId,
				stage: "persona",
				model: `${model.provider}/${model.id ?? "default"}`,
				startedAt,
				endedAt,
				durationMs: endedAt - startedAt,
				reason,
				attempts,
				added,
				targetRawId: null,
				cursorRawId: null,
				throughMemoryId,
				throughSceneRevId,
				...(error ? { error } : {}),
				...(usage.calls ? { usage } : {}),
				systemPrompt: PERSONA_WORKFLOW,
				trajectory,
			});
		} catch (runError) {
			console.error("persona run trajectory append failed:", runError);
		}
	}

	try {
		const loop = await runRalphLoop({
			maxAttempts: 1,
			signal: opts.signal,
			onPass: (pass, messages) => {
				trajectory.push({ attempt: pass, messages: snapshotTrajectory(messages) });
				addMessageUsage(usage, messages);
			},
			createPass: () => {
				const agent = new Agent({ streamFn: STREAM_FN, convertToLlm });
				agent.state.model = model;
				agent.state.systemPrompt = PERSONA_WORKFLOW;
				agent.state.tools = [
					createPersonaTool({
						dir: opts.dir,
						state,
						activeIds,
						throughSceneRevId,
						throughMemoryId,
						reason: opts.reason,
					}),
				];
				return { agent, prompt: personaPrompt(last, inputScenes, opts.reason) };
			},
			settlePass: () => (state.writes > 0 ? "done" : "stalled"),
		});
		attempts = loop.attempts;
		if (state.writes > 0) {
			added = state.writes;
			await rebuildPersonaView(opts.dir);
		}
		await endRun(loop.reason);
		return added;
	} catch (error) {
		added = state.writes;
		await endRun("error", error instanceof Error ? error.message : String(error));
		throw error;
	}
}
