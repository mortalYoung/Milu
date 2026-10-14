import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { ApplicationMenu, BrowserView, BrowserWindow, app as electrobunApp, Utils } from "electrobun/main";
import { BRAND } from "../shared/brand";
import { mcpChangedText } from "../shared/events";
import { originWindow, projectOrigin } from "../shared/origin";
import type { AppRPCSchema, ChatPreviewKind, RailView, ScheduleItem } from "../shared/rpc";
import { loadCustomCommands, mergeCommandDefinitions } from "./commands/custom";
import { defaultCommands } from "./commands/defaults";
import { createCommandRegistry } from "./commands/registry";
import { scaffoldCommandsDir } from "./commands/scaffold";
import type { CommandContext } from "./commands/types";
import { dailyActivity } from "./core/activity";
import { type AgentHandle, createAgent } from "./core/agent";
import {
	contextWindow,
	providerBaseUrl,
	providerModels,
	registerCustomProvider,
	resolveModel,
	supportedThinkingLevels,
	unregisterCustomProvider,
	validateCustomProviders,
} from "./core/agent-config";
import { askBtwThread, btwBaseContext, btwThreadsForAnchor, createBtwThread, readBtwThreads } from "./core/btw";
import { applyCompaction, type CompactionPlan, hasOrphanCompactionStart, planMemoryCompaction } from "./core/compaction";
import { Context } from "./core/context";
import { projectSnapshot } from "./core/context-project";
import { buildDashboardOverview } from "./core/dashboard";
import {
	checkpointCoversSession,
	consolidateMemory,
	type MemoryCheckpoint,
	type MemoryRecord,
	memoryCoveredIndex,
	memoryPendingStatus,
	organizeMemory,
	type QueryMemoryOptions,
	queryMemory,
	readMemoryLines,
	readMemoryRunSummaries,
} from "./core/memory";
import { buildMemoryOverview, readMemoryRunTrace } from "./core/memory-overview";
import { askPeer, claimInboundAsk, closeUnansweredAsk, type PeerEndpoint, type PeerHost, peerHopFor, pendingReply, sendReply } from "./core/peer";
import { latestPersona, organizePersona, personaTrigger, personaViewPath, readPersonaLines, rebuildPersonaView } from "./core/persona";
import { loadRuntimeStats, saveRuntimeStats } from "./core/runtime-stats";
import {
	currentSceneNavigation,
	foldScenes,
	MEMORY_SCENE_BATCH,
	organizeScenes,
	readSceneLines,
	rebuildSceneViews,
	type SceneCheckpoint,
	sceneNavigationPath,
	scenePendingCount,
	sceneViewsDir,
} from "./core/scenes";
import {
	advanceNext,
	checkAgentCreate,
	createDefinitionId,
	createScheduleClock,
	type DueFire,
	describeRule,
	hasSchedules,
	newDefinition,
	parseCronWhen,
	parseWhen,
	readRuns,
	ScheduleBusyError,
	type ScheduleClock,
	ScheduleConfigError,
	type ScheduleDefinition,
} from "./core/schedules";
import { createTaskRegistry, DEFAULT_REMIND_AFTER_SEC, type TaskHistoryRecord } from "./core/tasks";
import { aggregateUsage, lastUsage } from "./core/trajectory";
import { deleteApiKey, getApiKey, loadCredentials, setApiKey } from "./lib/credentials";
import { ensureModel, ensureSandboxMode, ensureStoragePath, ensureWorkspace, hasInvalidPersistedWorkspace, isThinkingLevel } from "./lib/ensure";
import { listChildren, readFilePreview, readImageDataUrl } from "./lib/explorer";
import { createFileWatch } from "./lib/file-watch";
import { gitChanges, gitDiff, gitFileSides, gitOverview, gitWorktrees } from "./lib/git-changes";
import { clearLastSession, type LastSession, readLastSession, type WindowFrame, writeLastSession } from "./lib/last-session";
import { listInstalledEditors, openInCodeEditor } from "./lib/open-in-editor";
import {
	partnerDirFor,
	persistModel,
	persistPartnerGrantedMcp,
	persistPartnerGrantedSkills,
	persistPartnerReadAt,
	persistSandboxMode,
	persistWorkspace,
	promptChangedSinceLastPersist,
	readPartnerGrantedMcp,
	readPartnerGrantedSkills,
	readPartnerReadAt,
	recordPrompt,
} from "./lib/partner-files";
import { partnerUsage } from "./lib/partner-usage";
import { searchFiles } from "./lib/search";
import {
	commandsDir,
	DEFAULT_MCP_CONFIG_PATH,
	DEFAULT_MEMORY_PENDING_ROUNDS,
	DEFAULT_PALETTE_IGNORE_DIRS,
	getPartnerDir,
	loadSettings,
	type Settings,
	saveSettings,
} from "./lib/settings";
import { isBuiltinMcp } from "./mcp/builtin";
import { loadMcpConfig, saveMcpConfig } from "./mcp/config";
import { McpManager } from "./mcp/manager";
import { copyPartner, createPartner, deletePartner, listPartners, PartnerError, type PartnerInput, promotePartner } from "./partners";
import type { EscalationDecision, EscalationRequest, SandboxMode } from "./permission";
import { isSandboxMode, SandboxManager, validateWorkspace } from "./permission";
import { createSessionStore, type SessionScope } from "./persist";
import { type ContextChangedEventData, EVENTS, type MemoryRunEndEventData, type MemoryRunStartEventData } from "./persist/events";
import { scanSkillsRoot } from "./skills/filesystem";
import { SKILL_NAME_RE } from "./skills/frontmatter";
import { getSkill, listSkillCandidates, listSkills } from "./skills/registry";
import type { SkillsService } from "./skills/types";
import { type McpAccess, type McpServerSummary, type PeerAccess, runEscalatedBash, type ScheduleSummary, type TaskAccess } from "./tools";

await loadCredentials();
const startupSettings = await loadSettings();
for (const def of startupSettings.customProviders ?? []) registerCustomProvider(def);

const session = createSessionStore();
const sandbox = new SandboxManager();
const mcpManager = new McpManager();
await mcpManager.reload();

const commandRegistry = createCommandRegistry();
{
	await scaffoldCommandsDir(commandsDir(startupSettings));
	const { defs: customDefs, errors: customErrors } = await loadCustomCommands(commandsDir(startupSettings));
	const merged = mergeCommandDefinitions(defaultCommands(), customDefs);
	for (const e of [...customErrors, ...merged.errors]) console.error("custom command:", e);
	commandRegistry.replace(merged.defs);
}

let commandsReloadTimer: ReturnType<typeof setTimeout> | undefined;
let commandsWatcher: ReturnType<typeof watch> | undefined;

async function reloadCommands() {
	const settings = await loadSettings();
	const dir = commandsDir(settings);
	armCommandsWatch(dir);
	await scaffoldCommandsDir(dir);
	const { defs, errors } = await loadCustomCommands(dir);
	const merged = mergeCommandDefinitions(defaultCommands(), defs);
	for (const e of errors) console.error("custom command:", e);
	for (const e of merged.errors) console.error("custom command:", e);
	commandRegistry.replace(merged.defs);
	rpc.send.command_update({});
}

function scheduleCommandsReload() {
	clearTimeout(commandsReloadTimer);
	commandsReloadTimer = setTimeout(() => void reloadCommands(), 300);
}

function armCommandsWatch(dir: string) {
	try {
		commandsWatcher?.close();
	} catch {}
	commandsWatcher = watch(dir, (_event, filename) => {
		if (typeof filename === "string" && filename.endsWith(".ts")) scheduleCommandsReload();
	});
}

let skillsWatchers: ReturnType<typeof watch>[] = [];
let skillsReloadTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSkillsRefresh() {
	clearTimeout(skillsReloadTimer);
	const settings = settingsCache ?? startupSettings;
	const delay = typeof settings.skills_watch_delay_ms === "number" && settings.skills_watch_delay_ms >= 0 ? settings.skills_watch_delay_ms : 300;
	skillsReloadTimer = setTimeout(() => void refreshSkillsChanged(), delay);
}

async function refreshSkillsChanged() {
	for (const pending of agents.values()) {
		void pending.then((e) => e.agent.invalidateSkillCatalog()).catch(() => {});
	}
	rpc.send.skills_change({});
}

const fileWatch = createFileWatch((path) => rpc.send.file_changed({ path }));

async function armSkillsWatchers() {
	const settings = settingsCache ?? (await ensureSettings());
	for (const w of skillsWatchers) {
		try {
			w.close();
		} catch {}
	}
	skillsWatchers = [];
	if (settings.skills_watch === false) return;
	const add = (dir: string | null) => {
		if (!dir) return;
		try {
			skillsWatchers.push(
				watch(dir, { recursive: true }, (_event, filename) => {
					if (typeof filename === "string" && filename.includes("/") && !filename.endsWith(".md")) return;
					scheduleSkillsRefresh();
				}),
			);
		} catch {}
	};
	const dirs = skillsDirsOf(settings);
	for (const dir of dirs) add(join(homedir(), dir));
	if (viewPartner) {
		const entry = await agents.get(viewPartner.name);
		const ws = entry?.agent.workspacePath ?? null;
		if (ws) for (const dir of dirs) add(join(ws, dir));
	}
}
const pendingCommandIds = new Set<string>();
const runningCommandPartners = new Set<string>();
const backgroundAborts = new Map<string, AbortController>();
const pendingShellIds = new Set<string>();
const pendingSandboxConfirms = new Map<string, { resolve: (decision: EscalationDecision) => void; to: SandboxMode; dir: string; partner: string }>();

const respondedSandboxIds = new Set<string>();

const escalationNonce = Date.now().toString(36);
let sandboxConfirmSeq = 0;
let appFocused = true;
let railView: RailView = "chat";

interface PartnerAgent {
	profile: PartnerInput;
	dir: string;
	scope: SessionScope;
	agent: AgentHandle;
}

let viewPartner: { name: string; dir: string; profile: PartnerInput } | null = null;

function looking(partner: string): boolean {
	return appFocused && railView === "chat" && viewPartner?.name === partner;
}

const agents = new Map<string, Promise<PartnerAgent>>();

let skillSeq = 0;
let shellSeq = 0;

const taskRegistry = createTaskRegistry({
	dirFor: (partner) => getPartnerDir(settingsCache ?? startupSettings, partner),
	loadHistory: (partner) => taskHistory(partner),
	onStart: (task) => {
		void session
			.scope(getPartnerDir(settingsCache ?? startupSettings, task.partner))
			.appendTaskStart({ taskId: task.id, command: task.command, logPath: task.logPath, ...(task.pid !== undefined ? { pid: task.pid } : {}) }, task.startedAt)
			.catch((error) => console.error("appendTaskStart failed:", error));
	},
	onEnd: (task) => {
		void session
			.scope(getPartnerDir(settingsCache ?? startupSettings, task.partner))
			.appendTaskEnd(
				{
					taskId: task.id,
					command: task.command,
					status: task.status,
					...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}),
					...(task.signalCode !== undefined ? { signalCode: task.signalCode } : {}),
				},
				task.endedAt ?? Date.now(),
			)
			.catch((error) => console.error("appendTaskEnd failed:", error));
	},
	onChange: (taskId, _partner, kind) => rpc.send.task_update({ taskId, kind }),
	notify: (partner, taskId, reason, remindAfter) => void notifyTask(partner, taskId, reason, remindAfter),
});

function taskAccess(partner: string): TaskAccess {
	return {
		start: (input) => taskRegistry.start({ partner, ...input }),
		read: (id, options) => taskRegistry.read(id, { ...(options ?? {}), partner }),
		subscribe: (id, remindAfter) => taskRegistry.subscribe(id, remindAfter, partner),
		stop: (id) => taskRegistry.stop(id, "model", partner),
	};
}

async function notifyTask(partner: string, taskId: string, reason: "exit" | "deadline", remindAfter?: number): Promise<void> {
	const entry = await agents.get(partner);
	if (!entry) return;
	const task = taskRegistry.get(taskId);
	const command = task?.command ?? "";
	const head =
		reason === "deadline"
			? `[task ${taskId}] still running at ${remindAfter ?? DEFAULT_REMIND_AFTER_SEC}s`
			: task?.status === "killed"
				? `[task ${taskId}] stopped`
				: `[task ${taskId}] ended${task?.exitCode !== undefined ? ` (exit ${task.exitCode})` : task?.signalCode ? ` (${task.signalCode})` : ""}`;
	const tail =
		reason === "deadline"
			? `You will still be notified when it ends.\ntask { op: "read", id: "${taskId}" } for output · task { op: "stop", id: "${taskId}" } to kill it`
			: `task { op: "read", id: "${taskId}" } for output`;
	await entry.agent.chat([head, `$ ${command}`, tail].join("\n"), { source: "task", taskId }).catch(() => {});
}

async function taskHistory(partner: string): Promise<TaskHistoryRecord[]> {
	const dir = getPartnerDir(settingsCache ?? startupSettings, partner);
	const entries = await session.rawEntries(dir);
	const ends = new Map<string, { status?: unknown; exitCode?: unknown; signalCode?: unknown; timestamp?: unknown }>();
	const starts: Array<{ id: string; command: string; logPath: string; startedAt: number }> = [];
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		const custom = entry as {
			customType?: string;
			data?: { taskId?: unknown; command?: unknown; logPath?: unknown; timestamp?: unknown; status?: unknown; exitCode?: unknown; signalCode?: unknown };
		};
		const data = custom.data;
		if (!data || data.taskId == null) continue;
		if (custom.customType === EVENTS.taskStart) {
			starts.push({
				id: String(data.taskId),
				command: String(data.command ?? ""),
				logPath: String(data.logPath ?? ""),
				startedAt: typeof data.timestamp === "number" ? data.timestamp : 0,
			});
		} else if (custom.customType === EVENTS.taskEnd) {
			ends.set(String(data.taskId), data);
		}
	}
	return starts
		.filter((start) => start.logPath)
		.map((start) => {
			const end = ends.get(start.id);
			const status = end?.status;
			return {
				...start,
				status: status === "exited" || status === "killed" ? status : "interrupted",
				...(typeof end?.exitCode === "number" ? { exitCode: end.exitCode } : {}),
				...(typeof end?.signalCode === "string" ? { signalCode: end.signalCode } : {}),
				...(typeof end?.timestamp === "number" ? { endedAt: end.timestamp } : {}),
			} satisfies TaskHistoryRecord;
		});
}

async function notifyRunEnd(name: string, dir: string, error?: string): Promise<void> {
	try {
		const last = await session.lastMessage(dir);
		const spoken = last?.kind === "assistant" || last?.kind === "send_message" ? last.text : "";
		const body = error || spoken || "Click to view the conversation";
		Utils.showNotification({ title: `${name} · ${error ? "run ended with an error" : "finished"}`, body: body.slice(0, 140) });
	} catch (failure) {
		console.error("run-end notification failed:", failure);
	}
}

function rejectPendingEscalations(partner: string, reason: string) {
	const timestamp = Date.now();
	for (const [id, pending] of pendingSandboxConfirms) {
		if (pending.partner !== partner) continue;
		pendingSandboxConfirms.delete(id);
		respondedSandboxIds.add(id);
		pending.resolve({ approved: false, reason });
		void session
			.scope(pending.dir)
			.appendEscalationRecord("escalation/decision", { escalationId: id, approved: false }, timestamp)
			.catch((error) => console.error("escalation decision failed:", error));
	}
}

async function explorerTarget(name: string, path: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
	const entry = await agents.get(name);
	if (!entry) return { ok: false, error: "no partner selected" };
	const workspace = entry.agent.workspacePath;
	if (!workspace) return { ok: false, error: "workspace not set" };
	const target = resolve(workspace, path);
	const rel = relative(workspace, target);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { ok: false, error: "path escapes workspace" };
	return { ok: true, path: target };
}

function tildify(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(home + sep)) return `~${path.slice(home.length)}`;
	return path;
}

async function findPartner(name: string): Promise<PartnerInput | undefined> {
	const settings = await loadSettings();
	return (await listPartners(settings)).find((partner) => partner.name === name);
}

function ensureAgent(profile: PartnerInput): Promise<PartnerAgent> {
	const existing = agents.get(profile.name);
	if (existing) return existing;

	const created = createPartnerAgent(profile).catch((error) => {
		if (agents.get(profile.name) === created) agents.delete(profile.name);
		throw error;
	});
	agents.set(profile.name, created);
	return created;
}

let settingsCache: Settings | null = null;

async function ensureSettings(): Promise<Settings> {
	const settings = await loadSettings();
	settingsCache = settings;
	return settings;
}

function skillsDirsOf(settings: Settings): string[] {
	return settings.skills_dirs?.length ? settings.skills_dirs : [".agents/skills"];
}

async function createPartnerAgent(profile: PartnerInput): Promise<PartnerAgent> {
	const dir = await partnerDirFor(profile.name);

	const storagePath = await ensureStoragePath(dir);

	const workspace = await ensureWorkspace(dir);

	const settings = await ensureSettings();

	const skillsService: SkillsService = {
		async list({ cwd, granted }) {
			const s = await ensureSettings();
			return listSkills({ cwd, home: homedir(), skillsDirs: skillsDirsOf(s), granted });
		},
		async get(name, { cwd, granted }) {
			const s = await ensureSettings();
			return getSkill(name, { cwd, home: homedir(), skillsDirs: skillsDirsOf(s), granted });
		},
	};
	const defaultMode = isSandboxMode(settings.defaultSandboxMode) ? settings.defaultSandboxMode : "workspace-write";
	const mode = await ensureSandboxMode(dir, defaultMode);
	const model = await ensureModel(dir);
	const modelSelection = model ? { provider: model.provider, ...(model.modelId ? { modelId: model.modelId } : {}) } : null;
	const readMemory = settings.memoryEnabled === false ? undefined : async (opts: QueryMemoryOptions) => queryMemory(await readMemoryLines(dir), opts);
	const mcpAccess: McpAccess = {
		list: () => listMcpForPartner(dir),
		call: async (server, tool, args, signal) => {
			const granted = await readPartnerGrantedMcp(dir);
			if (!granted.includes(server)) throw new Error(`MCP server "${server}" is not authorized for this partner`);
			return mcpManager.callTool(server, tool, args, signal);
		},
	};

	const scope = session.scope(dir);
	const agent = createAgent(
		{
			onTurnStart: (turn) => rpc.send.agent_turn({ turn, partner: profile.name }),
			onMessage: () => rpc.send.agent_message({ partner: profile.name }),
			onQueueChange: (event) => rpc.send.inbox_update({ partner: profile.name, ...event }),
			onPeerAsk: (item) => claimInboundAsk(profile.name, item),
			onEnd: (error) => {
				rejectPendingEscalations(profile.name, "run ended while awaiting approval");
				settleScheduledRun(agent, profile.name, error);
				rpc.send.agent_end({ error, partner: profile.name });
				if (!looking(profile.name)) void notifyRunEnd(profile.name, dir, error);
			},
			afterRun: () => {
				void closeUnansweredAsk(peerHost, profile.name).catch((failure) => console.error("closeUnansweredAsk failed:", failure));
				afterAgentRun(profile.name);
			},
		},
		{
			session: scope,
			runtimeStats: await loadRuntimeStats(dir),
			persistRuntimeStats: (snapshot) => void saveRuntimeStats(dir, snapshot).catch((error) => console.error("saveRuntimeStats failed:", error)),
			lastMessageTime: async () => (await session.lastMessage(dir))?.time ?? null,
			readMemory,
			sandbox,
			partnerDir: dir,
			grantedSkills: () => readPartnerGrantedSkills(dir),
			skills: skillsService,
			mcp: mcpAccess,
			peer: peerAccess(profile.name),
			tasks: taskAccess(profile.name),
			schedules: {
				list: async () => (await scheduleClockOf(profile.name))?.clock.definitions().map(scheduleSummaryOf) ?? [],
				create: async (input) => {
					if (agent.promptSource().source === "schedule") return { ok: false, error: "a scheduled run cannot put more work on the clock" };
					const result = await createSchedule(profile.name, { ...input, createdBy: "agent" });
					return result.ok ? { ok: true, schedule: scheduleSummaryOf(result.definition) } : { ok: false, error: result.error };
				},
			},
			onBeforeNextTurn: async (signal) => {
				const target = await agents.get(profile.name);
				if (!target) return null;
				return autoCompactBeforeNextTurn(target, signal);
			},
			onContextOverflow: async () => {
				const target = await agents.get(profile.name);
				if (!target) return false;
				try {
					const before = (await session.rawEntries(dir)).filter((e) => e.type === "custom" && e.customType === EVENTS.compaction).length;
					const flush = await flushMemoryForCompact(target);
					const plan = await planCompact(target, flush);
					if (!plan) return false;
					await runCompaction(target, plan);
					const after = (await session.rawEntries(dir)).filter((e) => e.type === "custom" && e.customType === EVENTS.compaction).length;
					return after > before;
				} catch (error) {
					await compactionFailure(target, error);
					return false;
				}
			},
			confirmEscalation: (request: EscalationRequest) =>
				new Promise<EscalationDecision>((resolve) => {
					if (agent.promptSource().source === "schedule") {
						resolve({ approved: false, reason: "unattended run — nobody is here to approve" });
						void scope
							.appendEscalationRecord("escalation/decision", { escalationId: `unattended-${++sandboxConfirmSeq}`, approved: false, unattended: true }, Date.now())
							.catch((error) => console.error("unattended escalation record failed:", error));
						return;
					}
					const id = `sbx-${escalationNonce}-${++sandboxConfirmSeq}`;
					pendingSandboxConfirms.set(id, { resolve, to: request.to, dir, partner: profile.name });

					void scope
						.appendEscalationRecord(
							"escalation/request",
							{
								escalationId: id,
								command: request.command,
								from: request.from,
								to: request.to,
								justification: request.justification,
								toolCallId: request.toolCallId,
							},
							Date.now(),
						)
						.then(() => {
							rpc.send.escalation_update({ partner: profile.name, escalationId: id, command: request.command, from: request.from, to: request.to });
							if (!looking(profile.name))
								Utils.showNotification({ title: `${profile.name} · sandbox escalation`, body: request.command.slice(0, 140), subtitle: `${request.from} → ${request.to}` });
						})
						.catch((error) => {
							console.error("confirmEscalation persist failed:", error);
							pendingSandboxConfirms.delete(id);
							resolve({ approved: false, reason: "escalation request could not be persisted" });
						});
				}),
		},
	);
	agent.setPartner(profile);
	agent.setStoragePath(storagePath);
	agent.setWorkspace(workspace);
	agent.setSandboxMode(mode);
	agent.setModel(modelSelection);
	agent.context.setThinkingLevel(model?.thinkingLevel ?? "high");
	agent.setThinkingLevel(agent.context.thinkingLevel);

	if (await promptChangedSinceLastPersist(dir, agent.systemPrompt)) {
		await scope.appendSystemPrompt(agent.systemPrompt, Date.now());
		await recordPrompt(dir, agent.systemPrompt);
	}

	const entry = { profile, dir, scope, agent };
	await reconcileTerminalStates(dir);

	await refreshMemoryContext(entry, { live: false });

	agent.restore(await session.deriveMessages(dir));

	if (await hasInvalidPersistedWorkspace(dir)) {
		await applyWorkspace(entry, null);
	}
	void ensureMemorySchedule(entry);
	if (settings.schedulesEnabled !== false) startScheduleClock(profile.name, dir);
	return entry;
}

type EscalationRequestRecord = NonNullable<Awaited<ReturnType<typeof session.escalationRequest>>>;
type ResumeTurn = NonNullable<Awaited<ReturnType<typeof session.resumeTurn>>>;

async function resumeApprovedEscalation(entry: PartnerAgent, request: EscalationRequestRecord, turn: ResumeTurn) {
	try {
		const { text, exitCode } = await withBackgroundAbort(entry.profile.name, (signal) =>
			runEscalatedBash(request.command, request.to, { permission: entry.agent.permission }, { signal }),
		);
		const result: ToolResultMessage = {
			role: "toolResult",
			toolCallId: request.toolCallId,
			toolName: "bash",
			content: [{ type: "text", text }],
			isError: exitCode !== 0 && exitCode !== undefined,
			timestamp: Date.now(),
		};

		entry.agent.restore([...turn.messages.slice(0, turn.insertAt), result, ...turn.messages.slice(turn.insertAt)]);
		await entry.scope.appendToolResult(result, Date.now());
		await entry.agent.continue();
	} catch (error) {
		console.error("resumeApprovedEscalation failed:", error);
	}
}

interface MemoryFlush {
	memoryAvailable: boolean;
	covered: boolean;
	coveredIndex: number;
	added: number;
	error?: string;
}

async function flushMemoryForCompact(entry: PartnerAgent, signal?: AbortSignal): Promise<MemoryFlush> {
	const settings = await ensureSettings();
	if (settings.memoryEnabled === false) return { memoryAvailable: false, covered: false, coveredIndex: -1, added: 0 };
	let added = 0;
	let error: string | undefined;
	try {
		const inFlight = memoryRuns.get(entry.profile.name);
		if (inFlight) {
			try {
				await inFlight;
			} catch {}
		}
		if (signal?.aborted) throw new Error("aborted");
		added = await runMemoryOrganize(entry, signal);
	} catch (flushError) {
		error = flushError instanceof Error ? flushError.message : String(flushError);
	}
	const entries = await session.rawEntries(entry.dir);
	const lines = await readMemoryLines(entry.dir);
	const checkpoints = lines.filter((line): line is MemoryCheckpoint => line.kind === "checkpoint");
	return {
		memoryAvailable: true,
		covered: checkpointCoversSession(checkpoints, entries),
		coveredIndex: memoryCoveredIndex(lines, entries),
		added,
		...(error ? { error } : {}),
	};
}

async function planCompact(entry: PartnerAgent, flush: MemoryFlush): Promise<CompactionPlan | null> {
	const settings = await ensureSettings();
	const entries = await session.rawEntries(entry.dir);
	const memoryEvents = await sessionMemories(entry);
	const digestMaxItems = settings.compaction?.digestMaxItems;
	return planMemoryCompaction(entries, {
		memoryEvents,
		covered: flush.covered,
		coveredIndex: flush.coveredIndex,
		memoryAvailable: flush.memoryAvailable,
		...(digestMaxItems ? { digestMaxItems } : {}),
	});
}

async function sessionMemories(entry: PartnerAgent): Promise<MemoryRecord[]> {
	const ids = new Set((await session.rawEntries(entry.dir)).map((e) => e.id));
	const lines = await readMemoryLines(entry.dir);
	return lines.filter((l): l is MemoryRecord => l.kind !== "checkpoint" && l.source.rawIds.some((id) => ids.has(id)));
}

async function runCompaction(entry: PartnerAgent, plan: CompactionPlan): Promise<void> {
	await applyCompaction(session, entry.dir, plan);
	await ensureContextAfterCompact(entry);
	rpc.send.origin_update({ partner: entry.profile.name });
}

async function compactionFailure(entry: PartnerAgent, error: unknown): Promise<void> {
	console.error("compact failed:", error);
	try {
		await session.scope(entry.dir).appendCompactionRecord("compaction/end", { ok: false, error: error instanceof Error ? error.message : String(error) }, Date.now());
	} catch {}
}

async function runManualCompact(entry: PartnerAgent, signal?: AbortSignal): Promise<{ ok: boolean; error?: string; compacted?: number }> {
	if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
	try {
		const flush = await flushMemoryForCompact(entry, signal);
		const plan = await planCompact(entry, flush);
		if (!plan) return { ok: true, compacted: 0 };
		await runCompaction(entry, plan);
		return { ok: true, compacted: plan.shadowed };
	} catch (error) {
		await compactionFailure(entry, error);
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function autoCompactBeforeNextTurn(entry: PartnerAgent, signal?: AbortSignal): Promise<AgentMessage[] | null> {
	const settings = await ensureSettings();
	const entries = await session.rawEntries(entry.dir);
	if (hasOrphanCompactionStart(entries)) {
		console.warn("compaction skipped: orphan compaction/start found (previous run may have crashed)");
		return null;
	}
	const usage = lastUsage(entries);
	if (!usage) return null;
	const window = contextWindow(entry.agent.model ?? undefined);
	const used = usage.input + usage.cacheRead + usage.cacheWrite;
	if (used < window * (settings.compaction?.thresholdRatio ?? 0.8)) return null;
	try {
		const flush = await flushMemoryForCompact(entry, signal);
		const plan = await planCompact(entry, flush);
		if (!plan) return null;
		await runCompaction(entry, plan);
		console.log(`auto-compacted ${plan.shadowed} entries (${plan.tier})`);
		return session.deriveMessages(entry.dir);
	} catch (error) {
		await compactionFailure(entry, error);
		return null;
	}
}

async function withBackgroundAbort<T>(partner: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	backgroundAborts.set(partner, controller);
	try {
		return await run(controller.signal);
	} finally {
		if (backgroundAborts.get(partner) === controller) backgroundAborts.delete(partner);
	}
}

// ——— scheduled tasks (definitions · clock · one gate per partner) ———

const scheduleClocks = new Map<string, ScheduleClock>();
/** Whoever holds the gate owns the chat's background work: a memory pass and a scheduled fire never overlap. */
const partnerGates = new Map<string, "schedule" | "memory">();

function claimPartnerGate(name: string, holder: "schedule" | "memory"): boolean {
	const current = partnerGates.get(name);
	if (current === holder) return true;
	if (current) return false;
	partnerGates.set(name, holder);
	return true;
}

function releasePartnerGate(name: string, holder: "schedule" | "memory"): void {
	if (partnerGates.get(name) === holder) partnerGates.delete(name);
}

function settleScheduledRun(agent: AgentHandle, name: string, error?: string): void {
	const active = agent.promptSource();
	if (active.source !== "schedule" || !active.scheduleId) return;
	const clock = scheduleClocks.get(name);
	const details = { ...(active.scheduleRunId ? { runId: active.scheduleRunId } : {}), ...(error ? { error } : {}) };
	void clock?.settle(active.scheduleId, error ? "failed" : "done", details).catch((failure) => console.error("schedule settle failed:", failure));
	if (!agent.queued().some((item) => item.source === "schedule")) releasePartnerGate(name, "schedule");
}

function startScheduleClock(name: string, dir: string): void {
	if (scheduleClocks.has(name)) return;
	const clock = createScheduleClock({
		partnerDir: dir,
		dispatch: (fire) => dispatchScheduleFire(name, fire),
		onSettle: (record) => {
			if (record.status !== "done" && record.status !== "failed") return;
			void (async () => {
				const entry = await agents.get(name);
				if (!entry) return;
				const definition = clock.definitions().find((item) => item.id === record.scheduleId);
				if (!definition) return;
				await entry.scope.appendScheduleRun(
					{
						runId: record.runId,
						scheduleId: record.scheduleId,
						scheduleTitle: definition.title,
						scheduledAt: record.scheduledAt,
						trigger: record.trigger,
						status: record.status,
						...(record.error ? { error: record.error } : {}),
					},
					Date.now(),
				);
			})().catch((failure) => console.error("schedule/run append failed:", failure));
		},
	});
	scheduleClocks.set(name, clock);
	void clock.start().catch((failure) => console.error("schedule clock start failed:", failure));
}

/** A fire has to reach a chat nobody is looking at: the partner is opened on demand. */
async function startScheduleClocks(): Promise<void> {
	try {
		const settings = await loadSettings();
		if (settings.schedulesEnabled === false) return;
		for (const profile of await listPartners(settings)) {
			const dir = getPartnerDir(settings, profile.name);
			if (await hasSchedules(dir)) startScheduleClock(profile.name, dir);
		}
	} catch (error) {
		console.error("schedule boot failed:", error);
	}
}

async function createSchedule(
	name: string,
	input: { when: string; text: string; title?: string; createdBy: "user" | "agent" },
): Promise<{ ok: true; definition: ScheduleDefinition; describe: string } | { ok: false; error: string }> {
	if (!input.text.trim()) return { ok: false, error: "a scheduled task needs something to do" };
	const found = await scheduleClockOf(name, { ensure: true });
	if (!found) return { ok: false, error: "unknown partner" };
	const now = Date.now();
	const parsed = input.createdBy === "agent" ? parseCronWhen(input.when, now) : parseWhen(input.when, now);
	if (parsed.error) return { ok: false, error: parsed.error };
	if (input.createdBy === "agent") {
		const refusal = checkAgentCreate(found.clock.definitions(), parsed.rule, now);
		if (refusal) return { ok: false, error: refusal };
	}
	const definition = newDefinition({
		id: createDefinitionId(),
		title: input.title?.trim() || parsed.describe,
		display: input.when.trim(),
		schedule: parsed.rule,
		payload: { kind: "prompt", text: input.text },
		workspaceIdentity: found.workspaceIdentity,
		createdBy: input.createdBy,
		now,
	});
	await found.clock.update((items) => [...items, definition]);
	rpc.send.schedule_update({ partner: name });
	return { ok: true, definition, describe: parsed.describe };
}

function scheduleSummaryOf(definition: ScheduleDefinition): ScheduleSummary {
	return {
		id: definition.id,
		title: definition.title,
		describe: describeRule(definition.schedule),
		status: definition.lifecycleStatus,
		nextRunAt: definition.retryAt ?? definition.nextRunAt,
		runCount: definition.runCount,
		lastError: definition.lastError,
		prompt: definition.payload.text,
	};
}

function scheduleItemOf(definition: ScheduleDefinition): ScheduleItem {
	return {
		id: definition.id,
		title: definition.title,
		display: definition.display,
		kind: definition.schedule.kind,
		describe: describeRule(definition.schedule),
		text: definition.payload.text,
		nextRunAt: definition.nextRunAt,
		retryAt: definition.retryAt,
		status: definition.lifecycleStatus,
		running: definition.running,
		runCount: definition.runCount,
		lastError: definition.lastError,
		createdAt: definition.createdAt,
	};
}

async function scheduleClockOf(name: string, options: { ensure?: boolean } = {}): Promise<{ clock: ScheduleClock; dir: string; workspaceIdentity: string | null } | null> {
	const settings = await loadSettings();
	const profile = (await listPartners(settings)).find((partner) => partner.name === name);
	if (!profile) return null;
	const dir = getPartnerDir(settings, name);
	const entry = options.ensure ? await ensureAgent(profile) : await agents.get(name);
	if (options.ensure || (await hasSchedules(dir))) startScheduleClock(name, dir);
	const clock = scheduleClocks.get(name);
	if (!clock) return null;
	return { clock, dir, workspaceIdentity: entry?.agent.workspacePath ?? null };
}

async function dispatchScheduleFire(name: string, fire: DueFire): Promise<void> {
	const definition = scheduleClocks
		.get(name)
		?.definitions()
		.find((item) => item.id === fire.id);
	if (!definition) throw new Error("schedule definition is gone");
	if (!claimPartnerGate(name, "schedule")) throw new ScheduleBusyError("partner is busy with another background run");
	try {
		const profile = await findPartner(name);
		if (!profile) throw new ScheduleConfigError("partner is gone");
		const entry = await ensureAgent(profile);
		if (definition.workspaceIdentity && definition.workspaceIdentity !== entry.agent.workspacePath)
			throw new ScheduleConfigError("workspace changed since this schedule was created");
		await scheduleClocks.get(name)?.noteDispatched(fire);
		await entry.scope.appendScheduleRun(
			{
				runId: fire.runId,
				scheduleId: definition.id,
				scheduleTitle: definition.title,
				scheduledAt: fire.scheduledAt,
				trigger: fire.trigger,
				status: "dispatched",
			},
			Date.now(),
		);
		await entry.agent.chat(definition.payload.text, { source: "schedule", scheduleId: definition.id, scheduleRunId: fire.runId, scheduleTitle: definition.title });
	} catch (error) {
		releasePartnerGate(name, "schedule");
		throw error;
	}
}

// ——— memory schedule (idle timer · round counter) ———
const DEFAULT_MEMORY_IDLE_MINUTES = 5;

interface MemorySchedule {
	idleTimer: ReturnType<typeof setTimeout> | null;
	rounds: number;
}

const memorySchedules = new Map<string, MemorySchedule>();
const memoryRuns = new Map<string, Promise<number>>();
const sceneRuns = new Map<string, Promise<number>>();
const personaRuns = new Map<string, Promise<number>>();
const consolidateRuns = new Map<string, Promise<number>>();

function memoryScheduleFor(name: string): MemorySchedule {
	let state = memorySchedules.get(name);
	if (!state) {
		state = { idleTimer: null, rounds: 0 };
		memorySchedules.set(name, state);
	}
	return state;
}

function cancelMemoryIdleTimer(name: string): void {
	const state = memorySchedules.get(name);
	if (state?.idleTimer) {
		clearTimeout(state.idleTimer);
		state.idleTimer = null;
	}
}

function armMemoryIdleTimerIn(name: string, delayMs: number): void {
	cancelMemoryIdleTimer(name);
	const state = memoryScheduleFor(name);
	state.idleTimer = setTimeout(
		() => {
			state.idleTimer = null;
			void triggerMemoryRun(name, "idle");
		},
		Math.max(1000, delayMs),
	);
}

async function armMemoryIdleTimer(name: string): Promise<void> {
	const settings = await loadSettings();
	if (settings.memoryEnabled === false) return;
	const minutes = settings.memoryIdleMinutes ?? DEFAULT_MEMORY_IDLE_MINUTES;
	if (minutes <= 0) {
		cancelMemoryIdleTimer(name);
		return;
	}
	armMemoryIdleTimerIn(name, minutes * 60_000);
}

async function triggerMemoryRun(name: string, reason: "idle" | "threshold" | "startup"): Promise<void> {
	try {
		const entry = await agents.get(name);
		if (!entry) return;
		if (!claimPartnerGate(name, "memory")) {
			await armMemoryIdleTimer(name);
			return;
		}
		try {
			await withBackgroundAbort(name, (signal) => runMemoryOrganize(entry, signal));
			await rearmMemoryIdleTimerIfPending(entry);
		} finally {
			releasePartnerGate(name, "memory");
		}
	} catch (error) {
		console.error(`memory ${reason} run failed:`, error);
	}
}

async function rearmMemoryIdleTimerIfPending(entry: PartnerAgent): Promise<void> {
	const dir = entry.dir;
	const entries = await session.rawEntries(entry.dir);
	const { pending } = await memoryPendingStatus(dir, entries);
	if (pending || (await pendingArchivedSessions(entry, dir)).length > 0) await armMemoryIdleTimer(entry.profile.name);
}

function afterAgentRun(name: string): void {
	void (async () => {
		try {
			const settings = await loadSettings();
			if (settings.memoryEnabled === false) return;
			const entry = await agents.get(name);
			if (!entry) return;
			const state = memoryScheduleFor(name);
			state.rounds += 1;
			const roundThreshold = settings.memoryPendingRounds ?? DEFAULT_MEMORY_PENDING_ROUNDS;
			if (roundThreshold > 0 && state.rounds >= roundThreshold) {
				state.rounds = 0;
				cancelMemoryIdleTimer(name);
				await triggerMemoryRun(name, "threshold");
				return;
			}
			await armMemoryIdleTimer(name);
			void refreshMemoryContext(entry, { live: true }).catch((error) => console.error("memory context refresh failed:", error));
		} catch (error) {
			console.error("memory schedule after run failed:", error);
		}
	})();
}

async function ensureMemorySchedule(entry: PartnerAgent): Promise<void> {
	try {
		const settings = await loadSettings();
		const name = entry.profile.name;
		if (settings.memoryEnabled === false) {
			cancelMemoryIdleTimer(name);
			return;
		}
		const dir = entry.dir;
		const entries = await session.rawEntries(entry.dir);
		const { pending: currentPending, rounds } = await memoryPendingStatus(dir, entries);
		const pending = currentPending || (await pendingArchivedSessions(entry, dir)).length > 0;
		const state = memoryScheduleFor(name);
		state.rounds = rounds;
		if (!pending) {
			cancelMemoryIdleTimer(name);
			return;
		}
		const roundThreshold = settings.memoryPendingRounds ?? DEFAULT_MEMORY_PENDING_ROUNDS;
		if (roundThreshold > 0 && rounds >= roundThreshold) {
			state.rounds = 0;
			cancelMemoryIdleTimer(name);
			void triggerMemoryRun(name, "startup");
			return;
		}
		const minutes = settings.memoryIdleMinutes ?? DEFAULT_MEMORY_IDLE_MINUTES;
		if (minutes <= 0) {
			cancelMemoryIdleTimer(name);
			return;
		}
		const last = await session.lastMessage(entry.dir);
		const elapsed = last ? Date.now() - last.time : Number.POSITIVE_INFINITY;
		if (elapsed >= minutes * 60_000) {
			void triggerMemoryRun(name, "startup");
			return;
		}
		armMemoryIdleTimerIn(name, minutes * 60_000 - elapsed);
	} catch (error) {
		console.error("memory schedule init failed:", error);
	}
	void rebuildMemoryViewsIfMissing(entry.dir);
	maybeRunSceneStage(entry);
}

function refreshMemorySchedules(): void {
	void (async () => {
		for (const name of agents.keys()) {
			cancelMemoryIdleTimer(name);
			const entry = await agents.get(name);
			if (!entry) continue;
			void ensureMemorySchedule(entry);
		}
	})();
}

// ——— memory pipeline (memory → scene → persona → consolidate) ———
function captureMemorySnapshot(entry: PartnerAgent): Promise<{ entries: Entry[] }> {
	return session.rawEntries(entry.dir).then((entries) => ({ entries }));
}

function runMemoryLog(entry: PartnerAgent): {
	start(data: MemoryRunStartEventData): Promise<void>;
	end(data: MemoryRunEndEventData): Promise<void>;
} {
	return {
		async start(data) {
			try {
				await entry.scope.appendMemoryRunStart(data, data.startedAt);
			} catch (error) {
				console.error("memory run start log failed:", error);
			}
		},
		async end(data) {
			try {
				await entry.scope.appendMemoryRunEnd(data, data.endedAt);
			} catch (error) {
				console.error("memory run end log failed:", error);
			}
		},
	};
}

async function pendingArchivedSessions(entry: PartnerAgent, dir: string): Promise<Array<{ file: string; entries: Entry[] }>> {
	const sessions = await session.listSessions(entry.dir);
	if (sessions.length <= 1) return [];
	const current = await session.currentSessionFile(entry.dir);
	const checkpoints = (await readMemoryLines(dir)).filter((line) => line.kind === "checkpoint");
	const out: Array<{ file: string; entries: Entry[] }> = [];
	for (const s of sessions) {
		if (!s.file || s.file === current) continue;
		const entries = await session.sessionEntries(entry.dir, s.file);
		if (checkpointCoversSession(checkpoints, entries)) continue;
		const { pending } = await memoryPendingStatus(dir, entries);
		if (pending) out.push({ file: s.file, entries });
	}
	return out;
}

async function drainArchivedSessions(
	entry: PartnerAgent,
	deps: { dir: string; model: NonNullable<ReturnType<typeof resolveModel>>; logRun: ReturnType<typeof runMemoryLog>; signal?: AbortSignal },
): Promise<void> {
	const pending = await pendingArchivedSessions(entry, deps.dir);
	for (const s of pending) {
		console.log(`memory drain: archived session ${s.file}`);
		await organizeMemory({
			dir: deps.dir,
			entries: s.entries,
			model: deps.model,
			logRun: deps.logRun,
			signal: deps.signal,
		});
	}
}

function runMemoryOrganize(entry: PartnerAgent, signal?: AbortSignal, snapshot?: { entries: Entry[] }): Promise<number> {
	const name = entry.profile.name;
	const running = memoryRuns.get(name);
	if (running) {
		if (snapshot) console.warn("memory organize already running; rotate snapshot will be drained later");
		return running;
	}
	let guarded: Promise<number>;
	const run = (async () => {
		const settings = await loadSettings();
		if (settings.memoryEnabled === false) return 0;
		const model = entry.agent.model ? resolveModel(entry.agent.model) : undefined;
		if (!model) return 0;
		const dir = entry.dir;
		const logRun = runMemoryLog(entry);
		await drainArchivedSessions(entry, { dir, model, logRun, signal });
		if (signal?.aborted) return 0;
		const snap = snapshot ?? (await captureMemorySnapshot(entry));
		const result = await organizeMemory({ dir, entries: snap.entries, model, logRun, signal });
		maybeRunSceneStage(entry, signal);
		return result;
	})();
	guarded = run.finally(() => {
		if (memoryRuns.get(name) === guarded) memoryRuns.delete(name);
		memoryScheduleFor(name).rounds = 0;
	});
	memoryRuns.set(name, guarded);
	return guarded;
}

function maybeRunSceneStage(entry: PartnerAgent, signal?: AbortSignal): void {
	if (signal?.aborted) return;
	void runSceneStage(entry, { signal }).catch((error) => console.error("scene stage failed:", error));
}

function runSceneStage(entry: PartnerAgent, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<number> {
	const name = entry.profile.name;
	const running = sceneRuns.get(name);
	if (running) return running;
	let guarded: Promise<number>;
	const run = (async () => {
		const settings = await loadSettings();
		if (settings.memoryEnabled === false) return 0;
		const model = entry.agent.model ? resolveModel(entry.agent.model) : undefined;
		if (!model) return 0;
		const dir = entry.dir;
		let added = 0;
		if (opts.force || (await scenePendingCount(dir)) >= MEMORY_SCENE_BATCH) {
			const logRun = runMemoryLog(entry);
			added = await organizeScenes({ dir, model, signal: opts.signal, logRun, reason: opts.force ? "manual" : "threshold", maxScenes: settings.memoryMaxScenes });
		}
		await runPersonaStage(entry, { signal: opts.signal }).catch((error) => console.error("persona stage failed:", error));
		return added;
	})();
	guarded = run.finally(() => {
		if (sceneRuns.get(name) === guarded) sceneRuns.delete(name);
	});
	sceneRuns.set(name, guarded);
	return guarded;
}

function runPersonaStage(entry: PartnerAgent, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<number> {
	const name = entry.profile.name;
	const running = personaRuns.get(name);
	if (running) return running;
	let guarded: Promise<number>;
	const run = (async () => {
		const settings = await loadSettings();
		if (settings.memoryEnabled === false) return 0;
		const model = entry.agent.model ? resolveModel(entry.agent.model) : undefined;
		if (!model) return 0;
		const dir = entry.dir;
		let added = 0;
		try {
			const trigger = opts.force ? { run: true, reason: "manual" as const } : await personaTrigger(dir);
			if (trigger.run && trigger.reason) {
				added = await organizePersona({ dir, model, signal: opts.signal, logRun: runMemoryLog(entry), reason: trigger.reason, ...(opts.force ? { force: true } : {}) });
			}
		} finally {
			await refreshMemoryContext(entry, { live: true }).catch((error) => console.error("memory context refresh failed:", error));
		}
		return added;
	})();
	guarded = run.finally(() => {
		if (personaRuns.get(name) === guarded) personaRuns.delete(name);
	});
	personaRuns.set(name, guarded);
	return guarded;
}

function runConsolidateStage(entry: PartnerAgent, signal?: AbortSignal): Promise<number> {
	const name = entry.profile.name;
	const running = consolidateRuns.get(name);
	if (running) return running;
	let guarded: Promise<number>;
	const run = (async () => {
		const settings = await loadSettings();
		if (settings.memoryEnabled === false) return 0;
		const model = entry.agent.model ? resolveModel(entry.agent.model) : undefined;
		if (!model) return 0;
		return await consolidateMemory({ dir: entry.dir, model, signal, logRun: runMemoryLog(entry) });
	})();
	guarded = run.finally(() => {
		if (consolidateRuns.get(name) === guarded) consolidateRuns.delete(name);
	});
	consolidateRuns.set(name, guarded);
	return guarded;
}

// ——— memory context & views ———
async function buildMemoryContext(dir: string): Promise<{ text: string; digest: string } | null> {
	const persona = latestPersona(await readPersonaLines(dir));
	const navigation = await currentSceneNavigation(dir);
	if (!persona && !navigation) return null;
	const digest = createHash("sha256")
		.update(JSON.stringify({ persona: persona?.id ?? null, navigation }))
		.digest("hex")
		.slice(0, 16);
	const parts = [`<memory_context digest="${digest}">`];
	if (persona) parts.push("# LONG-TERM PROFILE", "", persona.content);
	if (navigation) parts.push("", navigation);
	parts.push("</memory_context>");
	return { text: parts.join("\n"), digest };
}

function lastMemoryContextDigest(messages: AgentMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const content = (messages[i] as { content?: unknown }).content;
		if (typeof content !== "string") continue;
		const match = /<memory_context digest="([^"]+)">/.exec(content);
		if (match) return match[1];
	}
	return null;
}

async function refreshMemoryContext(entry: PartnerAgent, opts: { live: boolean }): Promise<void> {
	if ((await loadSettings()).memoryEnabled === false) return;
	if (opts.live && entry.agent.isStreaming) return;
	const next = await buildMemoryContext(entry.dir);
	if (!next) return;
	const messages = await session.deriveMessages(entry.dir);
	if (lastMemoryContextDigest(messages) === next.digest) return;
	await entry.scope.appendMemoryContext({ text: next.text, digest: next.digest }, Date.now());
	if (opts.live && !entry.agent.isStreaming) entry.agent.notifySystemReminder(next.text);
}

async function rebuildMemoryViewsIfMissing(dir: string): Promise<void> {
	try {
		const scenes = foldScenes(await readSceneLines(dir));
		if (scenes.length > 0) {
			const missingViews = await stat(sceneViewsDir(dir)).then(
				() => false,
				() => true,
			);
			const missingNavigation = await stat(sceneNavigationPath(dir)).then(
				() => false,
				() => true,
			);
			if (missingViews || missingNavigation) await rebuildSceneViews(dir);
		}
		const persona = latestPersona(await readPersonaLines(dir));
		if (persona) {
			const missing = await stat(personaViewPath(dir)).then(
				() => false,
				() => true,
			);
			if (missing) await rebuildPersonaView(dir);
		}
	} catch (error) {
		console.error("memory view rebuild failed:", error);
	}
}

async function memoryStatusReport(entry: PartnerAgent): Promise<string> {
	const dir = entry.dir;
	const entries = await session.rawEntries(entry.dir);
	const memoryLines = await readMemoryLines(dir);
	const totalRecords = memoryLines.filter((line) => line.kind !== "checkpoint").length;
	const active = queryMemory(memoryLines, { limit: Number.MAX_SAFE_INTEGER });
	const extractedIds = new Set(entries.map((entry) => entry.id));
	const checkpoint = [...memoryLines].reverse().find((line): line is MemoryCheckpoint => line.kind === "checkpoint" && extractedIds.has(line.source.lastRawId));
	const pending = await memoryPendingStatus(dir, entries);
	const sceneLines = await readSceneLines(dir);
	const scenes = foldScenes(sceneLines);
	const sceneRevisions = sceneLines.filter((line) => line.kind === "revision").length;
	const sceneCheckpoint = [...sceneLines].reverse().find((line): line is SceneCheckpoint => line.kind === "checkpoint");
	const scenePending = await scenePendingCount(dir);
	const persona = latestPersona(await readPersonaLines(dir));
	const trigger = await personaTrigger(dir);
	const runs = (await readMemoryRunSummaries(dir, 5)).runs;
	return [
		`memory status · ${entry.profile.name}`,
		`memory: ${totalRecords} records (${active.length} active) · checkpoint ${checkpoint?.source.lastRawId ?? "none"} · pending ${pending.pending ? `${pending.rounds} rounds` : "none"}`,
		`scenes: ${scenes.length} active / ${sceneRevisions} revisions · checkpoint ${sceneCheckpoint?.throughMemoryId ?? "none"} · pending ${scenePending} memories`,
		`persona: ${persona ? `v${persona.version} · ${new Date(persona.createdAt).toISOString().slice(0, 10)} · ${persona.sourceSceneIds.length} scenes` : "none"} · trigger ${trigger.run ? trigger.reason : "idle"}`,
		"runs:",
		...(runs.length
			? runs.map(
					(run) =>
						`  [${new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 16)}] ${run.stage} ${run.reason} added=${run.added} ${(run.durationMs / 1000).toFixed(1)}s`,
				)
			: ["  (none)"]),
	].join("\n");
}

// ——— reconcile terminal states: parked ———
async function reconcileTerminalStates(_dir: string): Promise<{ commands: number; shells: number; tasks: number; escalations: number; memoryRuns: number }> {
	return { commands: 0, shells: 0, tasks: 0, escalations: 0, memoryRuns: 0 };
}

async function applyWorkspace(entry: PartnerAgent, path: string | null): Promise<{ ok: true; workspace: string | null } | { ok: false; error: string }> {
	if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
	let resolved: string | null = null;
	if (path) {
		const decision = entry.agent.permission.setWorkspace(path);
		if (!decision.allowed) return { ok: false, error: decision.reason };
		resolved = decision.resolved;
	}
	await persistWorkspace(entry.dir, resolved);
	entry.agent.setWorkspace(resolved);
	await entry.agent.notifyContextChange();
	const settings = await ensureSettings();
	let agentMd: string | null = null;
	if (resolved) {
		try {
			agentMd = await readFile(join(resolved, settings.detect_instructions_file || "AGENTS.md"), "utf8");
		} catch {
			agentMd = null;
		}
	}
	await entry.scope.appendInstructionsChanged(agentMd, Date.now());
	entry.agent.restore(await session.deriveMessages(entry.dir));

	rpc.send.context_changed({ partner: entry.profile.name, workspace: entry.agent.workspacePath });
	void armSkillsWatchers();
	return { ok: true, workspace: resolved };
}

async function ensureWorkspaceValid(entry: PartnerAgent): Promise<void> {
	const workspace = entry.agent.workspacePath;
	if (!workspace) return;
	try {
		const info = await stat(workspace);
		if (info.isDirectory()) return;
	} catch {}

	await applyWorkspace(entry, null);
}

async function ensureContextAfterCompact(entry: PartnerAgent): Promise<void> {
	const workspace = entry.agent.workspacePath;
	const messages = await session.deriveMessages(entry.dir);
	if (!workspace) return;

	const hasWorkspaceContext = messages.some((m) => {
		const content = (m as { content?: unknown }).content;
		return typeof content === "string" && content.includes(`Current working directory: ${workspace}.`);
	});
	if (!hasWorkspaceContext) {
		const snapshot: ContextChangedEventData = {
			workspace,
			storage: entry.agent.storagePath,
			sandbox: entry.agent.sandboxMode,
			skills: entry.agent.context.skills.map((s) => ({ ...s })),
		};
		await entry.scope.appendContextChanged(snapshot, Date.now());
	}

	const settings = await ensureSettings();
	let agentMd: string | null = null;
	try {
		agentMd = await readFile(join(workspace, settings.detect_instructions_file || "AGENTS.md"), "utf8");
	} catch {
		agentMd = null;
	}
	const hasInstructions = messages.some((m) => {
		const content = (m as { content?: unknown }).content;
		return typeof content === "string" && content.toLowerCase().includes("working directory instructions");
	});
	if (!hasInstructions) await entry.scope.appendInstructionsChanged(agentMd, Date.now());

	await refreshMemoryContext(entry, { live: false });

	entry.agent.restore(await session.deriveMessages(entry.dir));
}

function commandContextFor(entry: PartnerAgent): CommandContext {
	return {
		partner: entry.profile.name,
		dir: entry.dir,
		scope: entry.scope,
		agent: {
			isStreaming: entry.agent.isStreaming,
			context: entry.agent.context,
			reset: () => entry.agent.reset(),
			setWorkspace: (path) => entry.agent.setWorkspace(path),
			permission: entry.agent.permission,
			snapshot: () =>
				projectSnapshot(entry.agent.context, {
					session,
					dir: entry.dir,
					systemPrompt: entry.agent.systemPrompt,
					tools: entry.agent.tools,
				}),
			prompt: (text) => entry.agent.chatAndWait(text),
			sendMessage: (text) => entry.agent.sendMessage(text),
			setModel: (model) => entry.agent.setModel(model),
			setSandboxMode: (mode) => entry.agent.setSandboxMode(mode),
			setThinkingLevel: (level) => entry.agent.setThinkingLevel(level),
		},
		persistWorkspace: (path) => persistWorkspace(entry.dir, path),
		applyWorkspace: (path) => applyWorkspace(entry, path),
		runManualCompact: async (signal?: AbortSignal) => {
			const result = await runManualCompact(entry, signal);
			return signal?.aborted ? { ok: false, error: "aborted" } : result;
		},
		organizeMemory: async (signal?: AbortSignal) => {
			try {
				if ((await loadSettings()).memoryEnabled === false) return { ok: false, error: "memory is disabled" };
				const added = await runMemoryOrganize(entry, signal);
				if (signal?.aborted) return { ok: false, error: "aborted" };
				return { ok: true, added };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		organizeScenes: async (signal?: AbortSignal) => {
			try {
				if ((await loadSettings()).memoryEnabled === false) return { ok: false, error: "memory is disabled" };
				const added = await runSceneStage(entry, { force: true, signal });
				if (signal?.aborted) return { ok: false, error: "aborted" };
				return { ok: true, added };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		organizePersona: async (signal?: AbortSignal) => {
			try {
				if ((await loadSettings()).memoryEnabled === false) return { ok: false, error: "memory is disabled" };
				const added = await runPersonaStage(entry, { force: true, signal });
				if (signal?.aborted) return { ok: false, error: "aborted" };
				return { ok: true, added };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		memoryStatus: async () => {
			try {
				return { ok: true, text: await memoryStatusReport(entry) };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		consolidateMemory: async (signal?: AbortSignal) => {
			try {
				if ((await loadSettings()).memoryEnabled === false) return { ok: false, error: "memory is disabled" };
				const added = await runConsolidateStage(entry, signal);
				if (signal?.aborted) return { ok: false, error: "aborted" };
				return { ok: true, added };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		resetSession: async (signal?: AbortSignal) => {
			if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
			try {
				const snapshot = await captureMemorySnapshot(entry);
				if (signal?.aborted) return { ok: false, error: "aborted" };
				await session.rotateSession(entry.dir);
				entry.agent.reset();
				pendingShellIds.clear();
				rpc.send.shell_update({});
				cancelMemoryIdleTimer(entry.profile.name);
				void runMemoryOrganize(entry, undefined, snapshot).catch((error) => console.error("memory rotate flush failed:", error));
				return { ok: true };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
		onCommandRun: (commandId) => {
			pendingCommandIds.add(commandId);
			runningCommandPartners.add(entry.profile.name);
			rpc.send.command_update({});
		},
		onCommandDone: (commandId) => {
			pendingCommandIds.delete(commandId);
			runningCommandPartners.delete(entry.profile.name);
			rpc.send.command_update({});
		},
	};
}

async function isPartnerBusy(name: string): Promise<boolean> {
	const entry = await agents.get(name);
	return Boolean(
		entry?.agent.isStreaming ||
			runningCommandPartners.has(name) ||
			memoryRuns.has(name) ||
			sceneRuns.has(name) ||
			personaRuns.has(name) ||
			consolidateRuns.has(name) ||
			(name === viewPartner?.name && pendingShellIds.size > 0),
	);
}

async function copyPartnerRpc(name: string, mode: "duplicate" | "fork") {
	try {
		const settings = await loadSettings();
		if (await isPartnerBusy(name)) return { ok: false as const, error: `"${name}" is still running; wait for it to finish` };
		const profile = await copyPartner(settings, { sourceName: name, mode }, session);
		return { ok: true as const, profile: { ...profile, path: getPartnerDir(settings, profile.name) } };
	} catch (error) {
		if (error instanceof PartnerError) return { ok: false as const, error: error.message };
		console.error(`${mode}_partner failed:`, error);
		return { ok: false as const, error: "Failed to copy partner" };
	}
}

async function promotePartnerRpc(name: string) {
	try {
		const settings = await loadSettings();
		if (await isPartnerBusy(name)) return { ok: false as const, error: `"${name}" is still running; wait for it to finish` };
		const profile = await promotePartner(settings, name);
		return { ok: true as const, profile: { ...profile, path: getPartnerDir(settings, profile.name) } };
	} catch (error) {
		if (error instanceof PartnerError) return { ok: false as const, error: error.message };
		console.error("promote_partner failed:", error);
		return { ok: false as const, error: "Failed to promote partner" };
	}
}

async function peerEndpoint(name: string): Promise<PeerEndpoint | undefined> {
	const settings = await loadSettings();
	const profile = (await listPartners(settings)).find((partner) => partner.name === name);
	if (!profile) return undefined;
	const entry = await ensureAgent(profile);
	const dir = getPartnerDir(settings, name);
	return {
		name,
		chat: (text, meta) => entry.agent.chat(text, meta),
		notice: (text, details) => session.scope(dir).appendSendMessage(text, details, Date.now()),
	};
}

const peerHost: PeerHost = { endpoint: peerEndpoint };

function peerAccess(asker: string): PeerAccess {
	return {
		async list() {
			const settings = await loadSettings();
			return (await listPartners(settings))
				.filter((partner) => partner.name !== asker)
				.map((partner) => ({ name: partner.name, ...(partner.forkedFrom ? { forkedFrom: partner.forkedFrom } : {}) }));
		},
		ask: (input) => askPeer(peerHost, { from: asker, to: input.peer, text: input.text, hop: peerHopFor(asker) }),
		pendingReply: () => pendingReply(asker),
		reply: (input) => sendReply(peerHost, { from: asker, ...input }),
	};
}

async function listMcpForPartner(dir: string): Promise<McpServerSummary[]> {
	const granted = await readPartnerGrantedMcp(dir);
	const resolved = await mcpManager.resolve(granted);
	return resolved.map((server) => ({
		name: server.name,
		tools: server.tools.map((tool) => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}) })),
		...(server.error ? { error: server.error } : {}),
	}));
}

async function editLastUserRpc(text: string) {
	if (!viewPartner) return { ok: false as const, error: "no partner selected" };
	if (await isPartnerBusy(viewPartner.name)) return { ok: false as const, error: `"${viewPartner.name}" is still running; stop it before editing` };
	try {
		const dir = viewPartner.dir;
		const entries = await session.rawEntries(dir);
		let lastUserIndex = -1;
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.type !== "message" || entry.message.role !== "user") continue;
			if (typeof (entry.message as { skill?: unknown }).skill === "string") continue;
			lastUserIndex = i;
		}
		if (lastUserIndex < 0) return { ok: false as const, error: "no user message to edit" };
		const userEntry = entries[lastUserIndex];
		let sawAborted = false;
		for (let i = lastUserIndex + 1; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.type === "message" && entry.message.role === "user" && typeof (entry.message as { skill?: unknown }).skill !== "string") {
				return { ok: false as const, error: "only the latest user message can be edited" };
			}
			if (entry.type !== "custom") continue;
			if (entry.customType === EVENTS.commandRun || entry.customType === EVENTS.skillRun || entry.customType === EVENTS.shellRun) {
				return { ok: false as const, error: "conversation moved on after this message" };
			}
			if (entry.customType === EVENTS.rewind) {
				const data = (entry.data ?? {}) as { targetId?: unknown } | undefined;
				if (data?.targetId === userEntry.id) continue;
			}
			if (entry.customType === EVENTS.agentEnd) {
				const reason = (entry.data as { reason?: unknown } | undefined)?.reason;
				if (reason === "completed") return { ok: false as const, error: "agent already replied" };
				if (reason === "aborted") sawAborted = true;
			}
		}
		if (!sawAborted) return { ok: false as const, error: "no stopped run to rewind" };

		const scope = session.scope(dir);
		const shadowedIds = entries.slice(lastUserIndex + 1).map((entry) => entry.id);
		const timestamp = Date.now();
		await scope.appendRewind({ targetId: userEntry.id, text, shadowedIds }, timestamp);

		const agentEntry = await ensureAgent(viewPartner.profile);
		agentEntry.agent.restore(await session.deriveMessages(dir));
		cancelMemoryIdleTimer(agentEntry.profile.name);
		agentEntry.agent.markUserMessage();
		await agentEntry.agent.continue();
		return { ok: true as const };
	} catch (error) {
		console.error("edit_last_user failed:", error);
		return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
	}
}

/** A page of the origin log is six conversations — six prompts and everything each of them set off. */
const ORIGIN_CONVERSATIONS = 6;

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: async ({ text }) => {
				const target = viewPartner;
				if (!target) return { accepted: false, queued: false };
				const entry = await ensureAgent(target.profile);
				await ensureWorkspaceValid(entry);

				rejectPendingEscalations(target.name, "superseded by a new user message");

				cancelMemoryIdleTimer(target.name);
				entry.agent.markUserMessage();
				const outcome = await entry.agent.chat(text);
				return { accepted: true, ...outcome };
			},
			follow_up_list: async ({ name }) => {
				const entry = await agents.get(name);
				return { items: entry?.agent.queued() ?? [] };
			},
			cancel_follow_up: async ({ id }) => {
				const entry = await agents.get(viewPartner?.name ?? "");
				if (entry?.agent.cancelQueued(id)) return { ok: true };
				return { ok: false, error: "queue-item-not-found" };
			},
			edit_last_user: async ({ text }) => editLastUserRpc(text),
			stop: () => {
				const name = viewPartner?.name;
				if (name) backgroundAborts.get(name)?.abort();
				void agents.get(name ?? "")?.then((e) => e.agent.stop());
				return { accepted: true };
			},
			window_zoom_toggle: () => {
				if (restoreFrame) {
					mainWindow.unmaximize();
					mainWindow.setFrame(restoreFrame.x, restoreFrame.y, restoreFrame.width, restoreFrame.height);
					restoreFrame = null;
					return { zoomed: false };
				}
				restoreFrame = mainWindow.getFrame();
				mainWindow.maximize();
				return { zoomed: true };
			},
			reset: () => {
				void agents.get(viewPartner?.name ?? "")?.then((e) => e.agent.reset());
				return { accepted: true };
			},

			session_origin: async ({ name, mode, cursor }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { entries: [], total: 0, hasMore: false, reset: false, baseDir: null };
				const dir = getPartnerDir(settings, name);
				const baseDir = (await agents.get(name))?.agent.workspacePath ?? null;
				const origin = projectOrigin(await session.rawEntries(dir));
				return { ...originWindow(origin, { mode, cursor, conversations: ORIGIN_CONVERSATIONS }), baseDir };
			},

			get_status: async ({ name }) => {
				const settings = await loadSettings();
				const partnersList = await listPartners(settings);
				const profile = partnersList.find((p) => p.name === name);
				const entry = profile ? await ensureAgent(profile) : undefined;
				const addedProviders = settings.providers ?? [];
				const workspacePath = entry?.agent.workspacePath ?? null;
				const git = workspacePath ? await gitOverview(workspacePath).catch(() => null) : null;
				return {
					workspace_path: workspacePath ? tildify(workspacePath) : null,
					is_git_repo: git !== null,
					change_count: git?.changeCount ?? 0,
					worktree_count: git?.worktreeCount ?? 0,
					storage_path: entry?.agent.storagePath ? tildify(entry.agent.storagePath) : null,
					sandbox_mode: entry?.agent.sandboxMode ?? "workspace-write",
					model: entry?.agent.model ?? null,
					thinking_level: entry?.agent.thinkingLevel ?? "high",
					thinking_levels: entry ? supportedThinkingLevels(entry.agent.model ?? undefined) : [],
					models: addedProviders.map((p) => ({ provider: p, models: providerModels(p) })),
				};
			},
			partner_usage: async ({ name }) => {
				const settings = await loadSettings();
				return partnerUsage(getPartnerDir(settings, name));
			},

			memory_overview: async ({ name }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { overview: null };
				return { overview: await buildMemoryOverview(session, getPartnerDir(settings, name)) };
			},

			schedule_list: async ({ name }) => {
				const found = await scheduleClockOf(name);
				if (!found) return { items: [], history: [] };
				const history = await readRuns(found.dir);
				return { items: found.clock.definitions().map(scheduleItemOf), history: history.slice(-50).reverse() };
			},

			schedule_create: async ({ name, when, text, title }) => {
				const result = await createSchedule(name, { when, text, ...(title ? { title } : {}), createdBy: "user" });
				return result.ok ? { ok: true, id: result.definition.id, describe: result.describe } : { ok: false, error: result.error };
			},

			schedule_update: async ({ name, id, patch }) => {
				const found = await scheduleClockOf(name);
				if (!found) return { ok: false, error: "unknown partner" };
				const parsed = patch.when == null ? null : parseWhen(patch.when, Date.now());
				if (parsed?.error) return { ok: false, error: parsed.error };
				await found.clock.update((items) =>
					items.map((item) => {
						if (item.id !== id) return item;
						const next: typeof item = {
							...item,
							...(patch.text != null && patch.text.trim() ? { payload: { kind: "prompt" as const, text: patch.text } } : {}),
							...(patch.title != null && patch.title.trim() ? { title: patch.title.trim() } : {}),
							...(parsed ? { schedule: parsed.rule, display: patch.when?.trim() ?? item.display } : {}),
							...(patch.enabled != null
								? { enabled: patch.enabled, lifecycleStatus: patch.enabled ? ("active" as const) : ("paused" as const), nextRunAt: null, retryAt: null, attempts: 0 }
								: {}),
						};
						const resuming = patch.enabled === true || parsed != null;
						return { ...next, nextRunAt: next.enabled && next.lifecycleStatus === "active" && resuming ? advanceNext(next.id, next.schedule, Date.now(), true) : next.nextRunAt };
					}),
				);
				rpc.send.schedule_update({ partner: name });
				return { ok: true, ...(parsed ? { describe: parsed.describe } : {}) };
			},

			schedule_run: async ({ name, id }) => {
				const found = await scheduleClockOf(name);
				if (!found) return { ok: false, error: "unknown partner" };
				const now = Date.now();
				const definition = found.clock.definitions().find((item) => item.id === id);
				if (!definition) return { ok: false, error: "unknown schedule" };
				if (partnerGates.has(name)) return { ok: false, error: "this chat is busy with another background run" };
				try {
					await dispatchScheduleFire(name, { kind: "fire", id, runId: `${id}:manual:${randomUUID().slice(0, 8)}`, scheduledAt: now, retry: 0, trigger: "manual" });
					return { ok: true };
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},

			schedule_delete: async ({ name, id }) => {
				const found = await scheduleClockOf(name);
				if (!found) return { ok: false };
				await found.clock.update((items) => items.filter((item) => item.id !== id));
				rpc.send.schedule_update({ partner: name });
				return { ok: true };
			},

			dashboard_overview: async ({ days }) => ({ overview: await buildDashboardOverview(session, days) }),

			memory_run_trace: async ({ name, runId }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { run: null };
				return { run: await readMemoryRunTrace(getPartnerDir(settings, name), runId) };
			},
			set_partner_model: async ({ name, model }) => {
				const profile = await findPartner(name);
				if (!profile) return { ok: false, error: "unknown partner" };
				const entry = await ensureAgent(profile);
				const normalized = { provider: model.provider, ...(model.modelId ? { modelId: model.modelId } : {}) };
				try {
					entry.agent.setModel(normalized);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
				await persistModel(entry.dir, { ...normalized, thinkingLevel: entry.agent.context.thinkingLevel });
				await entry.scope.appendModelChange(normalized, Date.now()).catch((error) => console.error("model_change append failed:", error));
				rpc.send.origin_update({ partner: entry.profile.name });
				return { ok: true };
			},
			set_thinking_level: async ({ name, level }) => {
				if (!isThinkingLevel(level)) return { ok: false, error: "invalid level" };
				const profile = await findPartner(name);
				if (!profile) return { ok: false, error: "unknown partner" };
				const entry = await ensureAgent(profile);
				const ctx = entry.agent.context;
				ctx.setThinkingLevel(level);
				await persistModel(entry.dir, {
					provider: ctx.model?.provider ?? "deepseek",
					...(ctx.model?.modelId ? { modelId: ctx.model.modelId } : {}),
					thinkingLevel: ctx.thinkingLevel,
				});
				entry.agent.setThinkingLevel(ctx.thinkingLevel);
				rpc.send.context_changed({ partner: entry.profile.name, workspace: entry.agent.workspacePath });
				return { ok: true };
			},
			set_sandbox_mode: async ({ name, mode }) => {
				if (!isSandboxMode(mode)) return { ok: false, error: "invalid mode" };
				const profile = await findPartner(name);
				if (!profile) return { ok: false, error: "unknown partner" };
				const entry = await ensureAgent(profile);
				entry.agent.setSandboxMode(mode);
				await persistSandboxMode(entry.dir, mode);
				rpc.send.sandbox_mode_update({});
				return { ok: true };
			},
			sandbox_respond: async ({ id, approved }) => {
				if (respondedSandboxIds.has(id)) return { ok: true };
				respondedSandboxIds.add(id);
				const pending = pendingSandboxConfirms.get(id);
				if (pending) pendingSandboxConfirms.delete(id);

				let resume: { entry: PartnerAgent; request: EscalationRequestRecord; turn: ResumeTurn } | null = null;
				if (!pending && approved) {
					const target = viewPartner;
					const entry = target ? await ensureAgent(target.profile) : undefined;

					if (entry && !entry.agent.isStreaming) {
						const request = await session.escalationRequest(entry.dir, id);
						const turn = request?.toolCallId ? await session.resumeTurn(entry.dir, request.toolCallId) : null;
						if (request && turn) {
							resume = { entry, request, turn };
						} else {
							approved = false;
						}
					} else {
						approved = false;
					}
				}

				const dir = pending?.dir ?? viewPartner?.dir;
				if (!dir) {
					respondedSandboxIds.delete(id);
					pending?.resolve({ approved: false, reason: "partner is gone" });
					return { ok: false };
				}
				try {
					await session.scope(dir).appendEscalationRecord("escalation/decision", { escalationId: id, approved }, Date.now());
				} catch (error) {
					console.error("sandbox_respond persist failed:", error);
					respondedSandboxIds.delete(id);
					pending?.resolve({ approved: false, reason: "decision could not be persisted" });
					return { ok: false };
				}
				if (pending) {
					pending.resolve(approved ? { approved: true, mode: pending.to } : { approved: false, reason: "rejected by user" });
				}
				rpc.send.escalation_update({ partner: pending?.partner ?? viewPartner?.name, escalationId: id, resolved: true });
				if (resume) void resumeApprovedEscalation(resume.entry, resume.request, resume.turn);
				return { ok: true };
			},
			pick_directory: async ({ startingFolder }) => {
				try {
					const raw = startingFolder || "~/";
					const expanded = raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
					const paths = await Utils.openFileDialog({
						startingFolder: expanded,
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					return { path: paths[0] ?? null };
				} catch {
					return { path: null };
				}
			},
			compact: async () => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				if (!target || !entry) return { ok: false, error: "no partner selected" };
				return withBackgroundAbort(target.name, (signal) => runManualCompact(entry, signal));
			},
			commands_list: async () => ({ commands: commandRegistry.list() }),
			commands_execute: async ({ line }) => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				if (!target || !entry) return { ok: false, error: "no partner selected" };
				if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
				if (runningCommandPartners.has(target.name)) return { ok: false, error: "command is running" };
				const ctx = commandContextFor(entry);
				const controller = new AbortController();
				backgroundAborts.set(target.name, controller);
				try {
					const execution = await commandRegistry.execute(line, ctx, controller);
					if (!execution) return { ok: false, error: "unknown command" };
					return { ok: true, commandId: execution.commandId, result: execution.result };
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				} finally {
					if (backgroundAborts.get(target.name) === controller) backgroundAborts.delete(target.name);
				}
			},

			skill_list: async ({ partner }) => {
				const settings = await ensureSettings();
				const name = partner ?? viewPartner?.name;
				if (!name) return { skills: [] };
				const dir = await partnerDirFor(name);
				const granted = await readPartnerGrantedSkills(dir);
				const entry = await agents.get(name);
				const cwd = entry?.agent.workspacePath ?? null;
				const skills = await listSkills({ cwd, home: homedir(), skillsDirs: skillsDirsOf(settings), granted });
				return {
					skills: skills.map((s) => ({
						name: s.name,
						description: s.description,
						...(s.whenToUse ? { whenToUse: s.whenToUse } : {}),
						scope: s.scope,
						userInvocable: s.invocation.userInvocable,
					})),
				};
			},

			skill_list_global: async () => {
				const settings = await ensureSettings();
				const candidates: Awaited<ReturnType<typeof scanSkillsRoot>> = [];
				const dirs = skillsDirsOf(settings);
				for (let i = 0; i < dirs.length; i++) {
					candidates.push(...(await scanSkillsRoot(join(homedir(), dirs[i]), "global", "global", 200 + i * 10)));
				}
				const seen = new Set<string>();
				const unique = [...candidates].sort((a, b) => a.rank - b.rank).filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
				const profiles = await listPartners(settings);
				const byName = new Map<string, string[]>();
				for (const profile of profiles) {
					const granted = await readPartnerGrantedSkills(getPartnerDir(settings, profile.name));
					for (const skill of granted) {
						const list = byName.get(skill) ?? [];
						if (!list.includes(profile.name)) list.push(profile.name);
						byName.set(skill, list);
					}
				}
				return {
					skills: unique.map((c) => ({
						name: c.name,
						description: c.description,
						...(c.path ? { path: c.path } : {}),
						grantedPartners: byName.get(c.name) ?? [],
					})),
				};
			},

			skill_execute: async ({ name, hint }) => {
				const target = viewPartner;
				if (!target) return { ok: false, error: "no partner selected" };
				const entry = await ensureAgent(target.profile);
				await ensureWorkspaceValid(entry);
				if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
				const settings = await ensureSettings();
				const granted = await readPartnerGrantedSkills(target.dir);
				const def = await getSkill(name, {
					cwd: entry.agent.workspacePath,
					home: homedir(),
					skillsDirs: skillsDirsOf(settings),
					granted,
				});
				if (!def) return { ok: false, error: `skill "${name}" is unknown or not granted` };
				if (!def.invocation.userInvocable) return { ok: false, error: `skill "${name}" is not user-invocable` };
				const skillId = `skill-${Date.now().toString(36)}-${++skillSeq}`;
				try {
					await entry.scope.appendSkillRun({ skillId, name, content: def.content, ...(hint ? { hint } : {}) }, Date.now());
					rpc.send.skill_update({});
					const resources = def.path ? `<skill_resources>\n${def.path}\n</skill_resources>` : "<skill_resources>\n</skill_resources>";
					const framed = `The user invoked skill "${name}"${hint ? ` with the request: ${hint}` : ""}:\n\n<skill_content name="${name}">\n${resources}\n<skill_instructions>\n${def.content}\n</skill_instructions>\n</skill_content>`;
					const result = await entry.agent.chatAndWait(framed, name);
					if (!result.ok) {
						await entry.scope.appendSkillDone({ skillId, name, kind: "error", ...(result.error ? { text: result.error } : {}) }, Date.now());
						rpc.send.skill_update({});
						return { ok: false, error: result.error };
					}
					await entry.scope.appendSkillDone({ skillId, name, kind: "success" }, Date.now());
					rpc.send.skill_update({});
					return { ok: true };
				} catch (error) {
					const text = error instanceof Error ? error.message : String(error);
					await entry.scope.appendSkillDone({ skillId, name, kind: "error", text }, Date.now()).catch(() => {});
					rpc.send.skill_update({});
					return { ok: false, error: text };
				}
			},

			shell_execute: async ({ command, timeout }) => {
				const target = viewPartner;
				if (!target) return { ok: false, error: "no partner selected" };
				const entry = await ensureAgent(target.profile);
				if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
				const shellId = `shell-${Date.now().toString(36)}-${++shellSeq}`;
				pendingShellIds.add(shellId);
				try {
					await entry.scope.appendShellRun({ shellId, command }, Date.now());
					rpc.send.shell_update({});
					const mode = entry.agent.permission.getMode();
					const result = await withBackgroundAbort(target.name, (signal) => runEscalatedBash(command, mode, { permission: entry.agent.permission }, { timeout, signal }));
					const text = result.text;
					await entry.scope.appendShellDone({ shellId, command, kind: "success", text, ...(typeof result.exitCode === "number" ? { exitCode: result.exitCode } : {}) }, Date.now());
					await entry.agent.sendShellMessage(`$ ${command}\n\n${text}`, shellId).catch(() => {});
					rpc.send.shell_update({});
					return { ok: true, shellId };
				} catch (error) {
					const text = error instanceof Error ? error.message : String(error);
					await entry.scope.appendShellDone({ shellId, command, kind: "error", text }, Date.now()).catch(() => {});
					await entry.agent.sendShellMessage(`$ ${command}\n\n${text}`, shellId).catch(() => {});
					rpc.send.shell_update({});
					return { ok: false, error: text, shellId };
				} finally {
					pendingShellIds.delete(shellId);
				}
			},

			open_external: ({ url }) => ({ ok: Utils.openExternal(url) }),

			task_list: async ({ name }) => ({ tasks: await taskRegistry.list(name) }),

			task_read: ({ name, id, offset, before, lines }) =>
				taskRegistry.read(id, {
					partner: name,
					...(offset !== undefined ? { offset } : {}),
					...(before !== undefined ? { before } : {}),
					...(lines !== undefined ? { lines } : {}),
				}),

			task_stop: ({ name, id }) => taskRegistry.stop(id, "user", name),

			open_path: async ({ path, editorId }) => {
				const opened = await openInCodeEditor(path, editorId);
				return opened ? { ok: true } : { ok: false, error: "No supported code editor found" };
			},

			list_editors: async () => ({
				editors: listInstalledEditors().map((e) => ({ id: e.id, name: e.name })),
			}),

			explorer_children: async ({ name, root, path }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				const rootPath = root === "workspace" ? entry.agent.workspacePath : entry.agent.storagePath;
				if (!rootPath) return { ok: false as const, error: root === "workspace" ? "workspace not set" : "storage not set" };
				try {
					const result = await listChildren(rootPath, path);
					return { ok: true as const, entries: result.entries, realPath: result.realPath };
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
				}
			},

			explorer_read_image: async ({ name, root, from, path }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				const rootPath = root === "workspace" ? entry.agent.workspacePath : entry.agent.storagePath;
				if (!rootPath) return { ok: false as const, error: root === "workspace" ? "workspace not set" : "storage not set" };
				try {
					const image = await readImageDataUrl(rootPath, from, path);
					return image.ok ? { ok: true as const, dataUrl: image.dataUrl } : { ok: false as const, error: image.error ?? "image unavailable" };
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
				}
			},

			git_changes: async ({ name }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				if (!entry.agent.workspacePath) return { ok: false as const, error: "workspace not set" };
				try {
					const result = await gitChanges(entry.agent.workspacePath);
					return { ok: true as const, repoRoot: result.repoRoot, changes: result.changes };
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
				}
			},

			git_diff: async ({ name, path, staged }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				if (!entry.agent.workspacePath) return { ok: false as const, error: "workspace not set" };
				try {
					const result = await gitDiff(entry.agent.workspacePath, path, { staged });
					return result.kind === "diff" ? { ok: true as const, kind: "diff" as const, diff: result.diff } : { ok: true as const, kind: "new" as const, content: result.content };
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
				}
			},

			git_file_sides: async ({ name, path, staged, from }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				if (!entry.agent.workspacePath) return { ok: false as const, error: "workspace not set" };
				try {
					const sides = await gitFileSides(entry.agent.workspacePath, path, { staged, from });
					return {
						ok: true as const,
						original: sides.original,
						modified: sides.modified,
						add: sides.add,
						del: sides.del,
						...(sides.binary ? { binary: true } : {}),
						...(sides.tooLarge ? { tooLarge: true } : {}),
					};
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
				}
			},

			git_worktrees: async ({ name }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				if (!entry.agent.workspacePath) return { ok: false as const, error: "workspace not set" };
				try {
					return { ok: true as const, ...(await gitWorktrees(entry.agent.workspacePath)) };
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
				}
			},

			explorer_reveal: async ({ name, path }) => {
				const target = await explorerTarget(name, path);
				if (!target.ok) return target;
				spawn("open", ["-R", target.path], { stdio: "ignore" }).unref();
				return { ok: true as const };
			},

			watch_file: async ({ name, root, path }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				const rootPath = root === "workspace" ? entry.agent.workspacePath : entry.agent.storagePath;
				if (!rootPath) return { ok: false as const, error: root === "workspace" ? "workspace not set" : "storage not set" };
				return fileWatch.arm({ key: `${name}|${root}|${path ?? ""}`, rootPath, relPath: path });
			},

			explorer_read_file: async ({ name, root, path }) => {
				const entry = await agents.get(name);
				if (!entry) return { ok: false as const, error: "no partner selected" };
				const rootPath = root === "workspace" ? entry.agent.workspacePath : entry.agent.storagePath;
				if (!rootPath) return { ok: false as const, error: root === "workspace" ? "workspace not set" : "storage not set" };
				try {
					const preview = await readFilePreview(rootPath, path);
					return {
						ok: true as const,
						content: preview.content,
						binary: preview.binary,
						truncated: preview.truncated,
						size: preview.size,
						...(preview.frontmatter ? { frontmatter: preview.frontmatter } : {}),
					};
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
				}
			},

			skill_get: async ({ name }) => {
				const target = viewPartner;
				if (!target) return { ok: false, error: "no partner selected" };
				const settings = await ensureSettings();
				const granted = await readPartnerGrantedSkills(target.dir);
				const entry = await agents.get(target.name);
				const def = await getSkill(name, {
					cwd: entry?.agent.workspacePath ?? null,
					home: homedir(),
					skillsDirs: skillsDirsOf(settings),
					granted,
				});
				if (!def) return { ok: false, error: `skill "${name}" is unknown or not granted` };
				return { ok: true, content: def.content };
			},

			skill_create: async ({ name, description }) => {
				if (!SKILL_NAME_RE.test(name)) return { ok: false, error: `invalid skill name "${name}"` };
				const settings = await ensureSettings();
				const dir = join(homedir(), skillsDirsOf(settings)[0], name);
				try {
					await mkdir(dir, { recursive: true });
					const file = join(dir, "SKILL.md");
					await writeFile(file, `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n# ${name}\n\nInstructions body for ${name}.\n`, "utf8");
					return { ok: true, path: file };
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},

			skill_delete: async ({ name }) => {
				const settings = await ensureSettings();
				try {
					for (const dir of skillsDirsOf(settings)) {
						await rm(join(homedir(), dir, name), { recursive: true, force: true });
						await rm(join(homedir(), dir, `${name}.md`), { force: true });
					}
					return { ok: true };
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},

			skill_reveal: async ({ name }) => {
				const settings = await ensureSettings();
				const candidates: Awaited<ReturnType<typeof scanSkillsRoot>> = [];
				const dirs = skillsDirsOf(settings);
				for (let i = 0; i < dirs.length; i++) {
					candidates.push(...(await scanSkillsRoot(join(homedir(), dirs[i]), "global", "global", 200 + i * 10)));
				}
				const candidate = candidates.find((c) => c.name === name);
				if (!candidate?.path) return { ok: false, error: `skill "${name}" not found` };
				spawn("open", ["-R", candidate.path], { stdio: "ignore" }).unref();
				return { ok: true };
			},

			skill_set_partners: async ({ name, partners }) => {
				const settings = await ensureSettings();
				const profiles = await listPartners(settings);
				const target = new Set(partners);
				for (const profile of profiles) {
					const dir = getPartnerDir(settings, profile.name);
					const current = await readPartnerGrantedSkills(dir);
					const next = target.has(profile.name) ? (current.includes(name) ? current : [...current, name]) : current.filter((s) => s !== name);
					if (next.join("\n") !== current.join("\n")) await persistPartnerGrantedSkills(dir, next);
				}
				scheduleSkillsRefresh();
				return { ok: true };
			},

			context_usage: async ({ name }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				const dir = profile ? getPartnerDir(settings, name) : null;
				const entry = profile ? await agents.get(name) : undefined;
				return projectSnapshot(entry?.agent.context ?? new Context(), {
					session,
					dir,
					systemPrompt: entry?.agent.systemPrompt,
					tools: entry?.agent.tools,
				});
			},
			partner_activity: async ({ name, weeks }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { days: [] };
				return { days: dailyActivity(await session.allRawEntries(getPartnerDir(settings, name)), weeks) };
			},
			stats: async ({ name }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				const dir = profile ? getPartnerDir(settings, name) : null;
				const entry = profile ? await agents.get(name) : undefined;
				const usage = dir ? aggregateUsage(await session.rawEntries(dir)) : null;
				return { usage, runtime: entry?.agent.runtimeStats ?? { turns: 0, avgTtftMs: null, avgTps: null, lastTtftMs: null } };
			},

			btw_threads: async ({ name, anchorEntryId }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { threads: [] };
				const dir = getPartnerDir(settings, name);
				return { threads: btwThreadsForAnchor(await readBtwThreads(dir), anchorEntryId) };
			},

			btw_create: async ({ name, anchorEntryId, question }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) throw new Error("partner not found");
				const dir = getPartnerDir(settings, name);
				const entries = await session.rawEntries(dir);
				const entry = await agents.get(name);
				const systemPrompt = entry?.agent.systemPrompt ?? "";
				const thread = await createBtwThread(dir, anchorEntryId, question, systemPrompt, btwBaseContext(entries, anchorEntryId));
				return { thread };
			},

			btw_ask: async ({ name, threadId, question }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) throw new Error("partner not found");
				const dir = getPartnerDir(settings, name);
				const entries = await session.rawEntries(dir);
				const threadBefore = await readBtwThreads(dir);
				const anchor = threadBefore.find((t) => t.id === threadId)?.anchorEntryId;
				if (!anchor) throw new Error("btw thread not found");
				const entry = await agents.get(name);
				const systemPrompt = entry?.agent.systemPrompt ?? "";
				const thread = await askBtwThread(dir, threadId, question, systemPrompt, btwBaseContext(entries, anchor));
				return { thread };
			},
			get_settings: async () => {
				const settings = await ensureSettings();
				return {
					settings,
					runtime: {
						providers: (settings.providers ?? []).map((id) => {
							const def = (settings.customProviders ?? []).find((d) => d.id === id);
							return {
								id,
								configured: Boolean(getApiKey(id)),
								baseUrl: def?.baseUrl ?? providerBaseUrl(id),
								modelCount: def ? def.models.length : providerModels(id).length,
							};
						}),
						allProviders: getBuiltinProviders(),
					},
				};
			},
			update_settings: async ({ settings, credentials }) => {
				try {
					const invalid = validateCustomProviders(settings.customProviders ?? []);
					if (invalid) return { ok: false, error: invalid };
					const prev = await loadSettings();
					const prevProviders = prev.providers ?? [];
					const nextProviders = settings.providers ?? [];
					const prevDefs = prev.customProviders ?? [];
					const nextDefs = settings.customProviders ?? [];
					if (credentials) {
						for (const [provider, key] of Object.entries(credentials)) {
							if (key) await setApiKey(provider, key);
							else await deleteApiKey(provider);
						}
					}
					await saveSettings(settings);
					settingsCache = settings;
					rememberSession = settings.rememberSession !== false;
					if (!rememberSession) clearLastSession();
					void armSkillsWatchers();
					for (const removed of prevProviders.filter((p) => !nextProviders.includes(p))) {
						await deleteApiKey(removed);
					}
					for (const def of nextDefs) registerCustomProvider(def);
					for (const gone of prevDefs.filter((d) => !nextDefs.some((n) => n.id === d.id))) {
						unregisterCustomProvider(gone.id);
					}
					await reloadCommands();
					refreshMemorySchedules();
					return { ok: true };
				} catch (error) {
					console.error("update_settings failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			mcp_get_config: async () => {
				const settings = await loadSettings();
				return { config: await loadMcpConfig(), configFile: settings.mcp_config_path?.trim() || DEFAULT_MCP_CONFIG_PATH };
			},
			mcp_save_options: async ({ options }) => {
				try {
					const settings = await loadSettings();
					if (options.configFile?.trim()) {
						settings.mcp_config_path = options.configFile.trim();
						await saveSettings(settings);
					}
					const config = await loadMcpConfig();
					const next = {
						...config,
						...(options.idleTimeoutSec != null ? { idleTimeoutSec: options.idleTimeoutSec } : {}),
						...(options.defaultLifecycle ? { defaultLifecycle: options.defaultLifecycle } : {}),
						...(options.maxBufferSize != null ? { maxBufferSize: options.maxBufferSize } : {}),
					};
					await saveMcpConfig(next);
					await mcpManager.reload();
					return { ok: true };
				} catch (error) {
					console.error("mcp_save_options failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			mcp_save_servers: async ({ servers }) => {
				try {
					if (servers.some((server) => !server.name || !server.transport?.command)) return { ok: false, error: "Invalid MCP server entry" };
					const config = await loadMcpConfig();
					const next = { ...config, servers };
					await saveMcpConfig(next);
					await mcpManager.reload();
					return { ok: true };
				} catch (error) {
					console.error("mcp_save_servers failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			mcp_test: async ({ name }) => {
				try {
					const tools = await mcpManager.listTools(name);
					return { ok: true, toolCount: tools.length };
				} catch (error) {
					console.error("mcp_test failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			mcp_list: async () => {
				const settings = await loadSettings();
				const profiles = await listPartners(settings);
				const statuses = mcpManager.statuses();
				const byName = new Map(statuses.map((status) => [status.name, status]));
				const servers = await Promise.all(
					mcpManager.listServers().map(async (server) => {
						const grantedPartners: string[] = [];
						for (const profile of profiles) {
							const grants = await readPartnerGrantedMcp(getPartnerDir(settings, profile.name));
							if (grants.includes(server.name)) grantedPartners.push(profile.name);
						}
						const status = byName.get(server.name);
						return {
							...server,
							builtin: isBuiltinMcp(server.name),
							lifecycle: status?.lifecycle ?? server.lifecycle ?? "lazy",
							state: status?.state ?? "stopped",
							toolCount: status?.toolCount ?? 0,
							...(status?.error ? { error: status.error } : {}),
							grantedPartners,
						};
					}),
				);
				return { servers };
			},
			mcp_set_partners: async ({ name, partners }) => {
				try {
					const settings = await loadSettings();
					const profiles = await listPartners(settings);
					const target = new Set(partners);
					for (const profile of profiles) {
						const dir = getPartnerDir(settings, profile.name);
						const current = await readPartnerGrantedMcp(dir);
						const adding = target.has(profile.name) && !current.includes(name);
						const removing = !target.has(profile.name) && current.includes(name);
						const next = adding ? [...current, name] : removing ? current.filter((server) => server !== name) : current;
						if (adding || removing) {
							await persistPartnerGrantedMcp(dir, next);
							const event = { server: name, change: adding ? ("added" as const) : ("removed" as const), granted: next };
							await session.scope(dir).appendMcpChanged(event, Date.now());
							const entry = await agents.get(profile.name);
							if (entry) (await entry).agent.notifySystemReminder(mcpChangedText(event));
						}
					}
					return { ok: true };
				} catch (error) {
					console.error("mcp_set_partners failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			mcp_partner_grants: async ({ name }) => {
				const settings = await loadSettings();
				const granted = await readPartnerGrantedMcp(getPartnerDir(settings, name));
				const byName = new Map(mcpManager.statuses().map((status) => [status.name, status]));
				return {
					servers: granted.map((server) => {
						const status = byName.get(server);
						return { name: server, state: status?.state ?? ("stopped" as const), toolCount: status?.toolCount ?? 0 };
					}),
				};
			},

			partner_access: async ({ name }) => {
				try {
					const settings = await loadSettings();
					const profile = (await listPartners(settings)).find((p) => p.name === name);
					if (!profile) return { skills: [], mcp: [] };
					const dir = getPartnerDir(settings, name);
					const grantedSkills = await readPartnerGrantedSkills(dir);
					const grantedMcp = await readPartnerGrantedMcp(dir);
					const entry = await agents.get(name);
					const workspace = entry?.agent.workspacePath ?? (await ensureWorkspace(dir));
					const skills = await listSkillCandidates({ cwd: workspace, home: homedir(), skillsDirs: skillsDirsOf(settings) });
					const statuses = new Map(mcpManager.statuses().map((status) => [status.name, status]));
					return {
						skills: skills.map((skill) => ({
							name: skill.name,
							description: skill.description,
							scope: skill.scope,
							granted: grantedSkills.includes(skill.name),
						})),
						mcp: mcpManager.listServers().map((server) => {
							const status = statuses.get(server.name);
							return { name: server.name, state: status?.state ?? ("stopped" as const), toolCount: status?.toolCount ?? 0, granted: grantedMcp.includes(server.name) };
						}),
					};
				} catch (error) {
					console.error("partner_access failed:", error);
					return { skills: [], mcp: [] };
				}
			},

			partner_set_skill: async ({ name, skill, granted }) => {
				try {
					const settings = await loadSettings();
					const dir = getPartnerDir(settings, name);
					const current = await readPartnerGrantedSkills(dir);
					const next = granted ? (current.includes(skill) ? current : [...current, skill]) : current.filter((entry) => entry !== skill);
					if (next.join("\n") !== current.join("\n")) await persistPartnerGrantedSkills(dir, next);
					scheduleSkillsRefresh();
					return { ok: true };
				} catch (error) {
					console.error("partner_set_skill failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},

			partner_set_mcp: async ({ name, server, granted }) => {
				try {
					const settings = await loadSettings();
					const dir = getPartnerDir(settings, name);
					const current = await readPartnerGrantedMcp(dir);
					const next = granted ? (current.includes(server) ? current : [...current, server]) : current.filter((entry) => entry !== server);
					if (next.join("\n") === current.join("\n")) return { ok: true };
					await persistPartnerGrantedMcp(dir, next);
					const event = { server, change: granted ? ("added" as const) : ("removed" as const), granted: next };
					void session
						.scope(dir)
						.appendMcpChanged(event, Date.now())
						.catch((error) => console.error("appendMcpChanged failed:", error));
					void agents
						.get(name)
						?.then((entry) => entry.agent.notifySystemReminder(mcpChangedText(event)))
						.catch((error) => console.error("mcp reminder failed:", error));
					return { ok: true };
				} catch (error) {
					console.error("partner_set_mcp failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			palette_search_files: async ({ name, query }) => {
				const settings = await loadSettings();
				const entry = await agents.get(name);
				const workspace = entry?.agent.workspacePath ?? (await ensureWorkspace(getPartnerDir(settings, name)));
				if (!workspace) return { ok: false as const, error: "workspace not set", items: [], truncated: false };
				try {
					const result = await searchFiles(workspace, query, settings.palette?.searchIgnoreDirs ?? DEFAULT_PALETTE_IGNORE_DIRS);
					return { ok: true as const, items: result.items, truncated: result.truncated };
				} catch (error) {
					return { ok: false as const, error: error instanceof Error ? error.message : String(error), items: [], truncated: false };
				}
			},
			list_partners: async () => {
				const settings = await loadSettings();
				const profiles = await listPartners(settings);

				const partners = await Promise.all(
					profiles.map(async (profile) => {
						const last = await session.lastMessage(getPartnerDir(settings, profile.name));
						const kind = last?.kind;
						const lastMessageKind: ChatPreviewKind | undefined =
							kind === "user" || kind === "assistant" || kind === "send_message" || kind === "command" || kind === "skill" || kind === "shell" ? kind : undefined;
						const startedAt = await session.sessionStartedAt(getPartnerDir(settings, profile.name));
						const readAt = await readPartnerReadAt(getPartnerDir(settings, profile.name));
						const agentEntry = await agents.get(profile.name);
						const writing = agentEntry?.agent.isStreaming === true || runningCommandPartners.has(profile.name);
						return {
							...profile,
							path: getPartnerDir(settings, profile.name),
							workspace: await ensureWorkspace(getPartnerDir(settings, profile.name)),
							readAt,
							startedAt,
							writing,
							...(last && lastMessageKind ? { lastMessage: last.text, lastMessageAt: last.time, lastMessageKind } : {}),
						};
					}),
				);
				return { partners };
			},
			create_partner: async (input) => {
				try {
					const settings = await loadSettings();
					if (input.workspace) {
						const dir = getPartnerDir(settings, input.name);
						const validationError = validateWorkspace(input.workspace, { storagePath: join(dir, "storage") });
						if (validationError) return { ok: false, error: validationError };
					}
					const profile = await createPartner(settings, input);
					const entry = await ensureAgent(profile);

					const providers = settings.providers ?? [];
					const first = providers[0] ? providerModels(providers[0])[0] : undefined;
					if (first) {
						const pin = { provider: providers[0], modelId: first.id };
						entry.agent.setModel(pin);
						await persistModel(entry.dir, pin);
					}
					if (input.workspace) {
						const applied = await applyWorkspace(entry, input.workspace);
						if (!applied.ok) return { ok: false, error: applied.error };
					}
					return { ok: true, profile: { ...profile, path: getPartnerDir(settings, profile.name) } };
				} catch (error) {
					if (error instanceof PartnerError) return { ok: false, error: error.message };
					console.error("create_partner failed:", error);
					return { ok: false, error: "Failed to create partner" };
				}
			},

			set_menu_state: async ({ partner, workspace, git }) => {
				menuState.partner = partner;
				menuState.workspace = workspace;
				menuState.git = git;
				refreshMenu();
				return { ok: true };
			},
			set_view: async ({ view }) => {
				railView = view;
				refreshMenu();
				return { ok: true };
			},

			set_partner: async ({ profile }) => {
				if (profile) {
					const dir = await partnerDirFor(profile.name);
					viewPartner = { name: profile.name, dir, profile };
					const entry = await ensureAgent(profile);

					rpc.send.context_changed({ partner: profile.name, workspace: entry.agent.workspacePath });
					void armSkillsWatchers();
				} else {
					viewPartner = null;
					void armSkillsWatchers();
				}
				if (rememberSession) {
					lastSession = { ...lastSession, partner: profile?.name ?? null };
					writeLastSession(lastSession);
				}
				return { ok: true };
			},
			last_partner: () => ({ partner: rememberSession ? lastSession.partner : null }),
			duplicate_partner: async ({ name }) => copyPartnerRpc(name, "duplicate"),
			fork_partner: async ({ name }) => copyPartnerRpc(name, "fork"),
			promote_partner: async ({ name }) => promotePartnerRpc(name),
			delete_partner: async ({ name }) => {
				try {
					const settings = await loadSettings();
					const before = await listPartners(settings);
					const affected = [name, ...before.filter((p) => p.forkedFrom === name).map((p) => p.name)];
					const runMaps = [memoryRuns, sceneRuns, personaRuns, consolidateRuns];
					const trackedRuns = (targets: string[]) =>
						runMaps.flatMap((runs) => targets.map((target) => runs.get(target))).filter((run): run is Promise<number> => run !== undefined);

					const draining: Promise<unknown>[] = [];
					for (const target of affected) {
						const dir = getPartnerDir(settings, target);
						const entry = agents.get(target);
						if (entry) {
							draining.push(
								entry.then(async (partner) => {
									partner.agent.stop();
									await partner.agent.waitForIdle();
								}),
							);
						}
						draining.push(...trackedRuns([target]));
						backgroundAborts.get(target)?.abort();
						cancelMemoryIdleTimer(target);
						agents.delete(target);
						memorySchedules.delete(target);
						scheduleClocks.get(target)?.stop();
						scheduleClocks.delete(target);
						partnerGates.delete(target);
						for (const runs of runMaps) runs.delete(target);
						session.evictRoot(dir);
						if (viewPartner?.name === target) viewPartner = null;
					}

					let inFlight = draining;
					for (let round = 0; inFlight.length > 0 && round < 3; round += 1) {
						await Promise.allSettled(inFlight);
						inFlight = trackedRuns(affected);
					}

					await deletePartner(settings, name);
					return { ok: true };
				} catch (error) {
					if (error instanceof PartnerError) return { ok: false, error: error.message };
					console.error("delete_partner failed:", error);
					return { ok: false, error: "Failed to delete partner" };
				}
			},
			set_read_at: async ({ name, readAt }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { ok: false };
				await persistPartnerReadAt(getPartnerDir(settings, name), readAt);
				return { ok: true };
			},
		},
		messages: {
			history_timing: ({ partner, rpcMs, buildMs, renderMs, items }) => {
				console.log(
					`[timing] view history: rpc=${rpcMs.toFixed(1)}ms build=${buildMs.toFixed(1)}ms render=${renderMs.toFixed(1)}ms total=${(rpcMs + buildMs + renderMs).toFixed(1)}ms items=${items} partner=${partner}`,
				);
			},
		},
	},
});

const menuState = { partner: false, workspace: false, git: false };

type AppMenuItem = Parameters<typeof ApplicationMenu.setApplicationMenu>[0][number];

function buildMenu(): AppMenuItem[] {
	return [
		{
			label: BRAND,
			submenu: [
				{ role: "about", label: `About ${BRAND}` },
				{ type: "divider" },
				{ label: "Settings…", action: "milu.settings", accelerator: "Command+," },
				{ type: "divider" },
				{ role: "hide", accelerator: "Command+H" },
				{ role: "hideOthers", accelerator: "Command+Option+H" },
				{ role: "showAll" },
				{ type: "divider" },
				{ role: "quit", label: `Quit ${BRAND}`, accelerator: "Command+Q" },
			],
		},
		{
			label: "Chat",
			submenu: [
				{ label: "Create", action: "milu.new-partner", accelerator: "Command+N" },
				{
					label: railView === "chat" ? "Close Chat" : railView === "dashboard" ? "Close Dashboard" : "Close Skills",
					action: "milu.close-chat",
					accelerator: "Command+W",
					enabled: railView !== "chat" || menuState.partner,
				},
				{ label: "Chat Detail", action: "milu.details", accelerator: "Command+E", enabled: menuState.partner },
				{ type: "divider" },
				{ label: "Open Trajectory", action: "milu.trajectory", enabled: menuState.partner },
				{ label: "Open Replies", action: "milu.replies", enabled: menuState.partner },
				{ type: "divider" },
				{ label: "Open Workspace", action: "milu.workspace", enabled: menuState.workspace },
				{ label: "Open Git Changes", action: "milu.git-changes", enabled: menuState.git },
				{ type: "divider" },
				{ label: "Toggle Chat List", action: "milu.toggle-list", accelerator: "Command+B" },
			],
		},
		{
			label: "View",
			submenu: [
				{ label: "Command Palette…", action: "milu.palette", accelerator: "Command+P" },
				{ label: "Manage Access…", action: "milu.access", accelerator: "Command+Shift+P" },
				{ type: "divider" },
				{
					label: "Switch to",
					submenu: [
						{ label: "Chat", action: "milu.view-chat" },
						{ label: "Skills", action: "milu.view-skills" },
						{ label: "Dashboard", action: "milu.view-dashboard" },
					],
				},
				{ type: "divider" },
				{ role: "toggleFullScreen", accelerator: "Control+Command+F" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "divider" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "pasteAndMatchStyle" },
				{ type: "divider" },
				{ role: "selectAll" },
			],
		},
		{
			label: "Window",
			submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "divider" }, { role: "bringAllToFront" }],
		},
	];
}

function refreshMenu() {
	ApplicationMenu.setApplicationMenu(buildMenu());
}

ApplicationMenu.on("application-menu-clicked", (event) => {
	const { action } = (event as { data?: { action?: string } }).data ?? {};
	if (typeof action !== "string" || !action.startsWith("milu.")) return;
	rpc.send.menu_command({ action });
});

refreshMenu();

armCommandsWatch(commandsDir(startupSettings));
void armSkillsWatchers();

let restoreFrame: { x: number; y: number; width: number; height: number } | null = null;

const DEFAULT_FRAME: WindowFrame = { x: 120, y: 60, width: 1200, height: 800 };
/** 窗口的地板：这版 Electrobun 的 BrowserWindow 没有 minSize，就在 resize 里自己兜住 ——
    比这更窄的窗里，三个区怎么排都不是能读的样子（信纸地板 420 + 至少一列）。 */
const WINDOW_MIN = { width: 560, height: 480 };
let rememberSession = startupSettings.rememberSession !== false;
let lastSession: LastSession = (rememberSession ? readLastSession() : null) ?? { frame: DEFAULT_FRAME, maximized: false, partner: null };
let frameTimer: ReturnType<typeof setTimeout> | undefined;

const mainWindow: BrowserWindow = new BrowserWindow({
	title: BRAND,

	titleBarStyle: "hiddenInset",
	trafficLightOffset: { x: 0, y: 10 },
	url: "views://mainview/index.html",
	rpc,
	frame: {
		...lastSession.frame,
		width: Math.max(lastSession.frame.width, WINDOW_MIN.width),
		height: Math.max(lastSession.frame.height, WINDOW_MIN.height),
	},
});

if (lastSession.maximized) mainWindow.maximize();

function clampWindowSize(): void {
	const frame = mainWindow.getFrame();
	const width = Math.max(frame.width, WINDOW_MIN.width);
	const height = Math.max(frame.height, WINDOW_MIN.height);
	if (width === frame.width && height === frame.height) return;
	mainWindow.setSize(width, height);
}

function onWindowResize(): void {
	clampWindowSize();
	rememberWindowFrame();
}

function rememberWindowFrame(): void {
	if (!rememberSession) return;
	lastSession = { ...lastSession, frame: mainWindow.getFrame(), maximized: mainWindow.isMaximized() };
	clearTimeout(frameTimer);
	frameTimer = setTimeout(() => writeLastSession(lastSession), 400);
}

mainWindow.on("resize", onWindowResize);
mainWindow.on("move", rememberWindowFrame);

electrobunApp.on("before-quit", () => {
	taskRegistry.reapAll();
	for (const clock of scheduleClocks.values()) clock.stop();
	scheduleClocks.clear();
	fileWatch.stop();
	clearTimeout(frameTimer);
	if (rememberSession) writeLastSession({ ...lastSession, frame: mainWindow.getFrame(), maximized: mainWindow.isMaximized() });
});
void startScheduleClocks();
mainWindow.on("focus", () => {
	appFocused = true;
});
mainWindow.on("blur", () => {
	appFocused = false;
});

console.log("\x1b[32mmilu started — agent ready\x1b[0m");
