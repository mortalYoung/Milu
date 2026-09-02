import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { ApplicationMenu, BrowserView, BrowserWindow, Utils } from "electrobun/main";
import type { AppRPCSchema } from "../shared/rpc";
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
import { applyCompaction, type CompactionPlan, hasOrphanCompactionStart, planCompaction } from "./core/compaction";
import { Context } from "./core/context";
import { projectSnapshot } from "./core/context-project";
import { loadRuntimeStats, saveRuntimeStats } from "./core/runtime-stats";
import { createLlmSummarizer, localSummarizer } from "./core/summarizer";
import { reconstructRequestHeader } from "./core/surface";
import { applyToolResultPrunes, planToolResultPrunes } from "./core/tool-result-pruner";
import { aggregateUsage, dedupeRequestHeaders, fold, lastUsage } from "./core/trajectory";
import { deleteApiKey, getApiKey, loadCredentials, setApiKey } from "./lib/credentials";
import { ensureModel, ensureSandboxMode, ensureStoragePath, ensureWorkspace, isThinkingLevel } from "./lib/ensure";
import {
	partnerDirFor,
	persistModel,
	persistPartnerGrantedSkills,
	persistPartnerReadAt,
	persistSandboxMode,
	persistWorkspace,
	promptChangedSinceLastPersist,
	readPartnerGrantedSkills,
	readPartnerReadAt,
	recordPrompt,
} from "./lib/partner-files";
import { commandsDir, getPartnerDir, loadSettings, type Settings, saveSettings, sendMessageIntervalMs } from "./lib/settings";
import { createPartner, deletePartner, listPartners, PartnerError, type PartnerInput } from "./partners";
import type { EscalationDecision, EscalationRequest, SandboxMode } from "./permission";
import { isSandboxMode, SandboxManager } from "./permission";
import { createSessionStore, type SessionScope } from "./persist";
import { scanSkillsRoot } from "./skills/filesystem";
import { SKILL_NAME_RE } from "./skills/frontmatter";
import { getSkill, listSkills } from "./skills/registry";
import type { SkillsService } from "./skills/types";
import { runEscalatedBash } from "./tools";

await loadCredentials();
const startupSettings = await loadSettings();
for (const def of startupSettings.customProviders ?? []) registerCustomProvider(def);

const session = createSessionStore();
const sandbox = new SandboxManager();

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
const pendingShellIds = new Set<string>();
const pendingSandboxConfirms = new Map<string, { resolve: (decision: EscalationDecision) => void; to: SandboxMode; dir: string; partner: string }>();

const respondedSandboxIds = new Set<string>();

const escalationNonce = Date.now().toString(36);
let sandboxConfirmSeq = 0;

interface PartnerAgent {
	profile: PartnerInput;
	dir: string;
	scope: SessionScope;
	agent: AgentHandle;
}

let viewPartner: { name: string; dir: string; profile: PartnerInput } | null = null;

const agents = new Map<string, Promise<PartnerAgent>>();

let skillSeq = 0;
let shellSeq = 0;

function pendingEscalationCount(partner: string): number {
	let n = 0;
	for (const pending of pendingSandboxConfirms.values()) {
		if (pending.partner === partner) n += 1;
	}
	return n;
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

function tildify(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(home + sep)) return `~${path.slice(home.length)}`;
	return path;
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
	const thinkingLevel = model?.thinkingLevel ?? "high";

	const scope = session.scope(dir);
	const agent = createAgent(
		{
			onTurnStart: (turn) => rpc.send.agent_turn({ turn, partner: profile.name }),
			onMessage: () => rpc.send.agent_message({}),
			onTrajectoryUpdate: () => rpc.send.trajectory_update({}),
			onWorkspaceUpdate: () => {
				rpc.send.workspace_update({});
				void armSkillsWatchers();
			},
			onWorkspaceSet: (path) => void persistWorkspace(dir, path),
			onEnd: (error) => {
				rejectPendingEscalations(profile.name, "run ended while awaiting approval");
				rpc.send.agent_end({ error, partner: profile.name });
				void agents.get(profile.name)?.then((e) => void maybeAutoCompact(e));
			},
		},
		{
			session: scope,
			runtimeStats: await loadRuntimeStats(dir),
			persistRuntimeStats: (snapshot) => void saveRuntimeStats(dir, snapshot).catch((error) => console.error("saveRuntimeStats failed:", error)),
			sandbox,
			deliverIntervalMs: () => sendMessageIntervalMs(settingsCache ?? settings),
			partnerDir: dir,
			grantedSkills: () => readPartnerGrantedSkills(dir),
			skills: skillsService,
			onContextOverflow: async () => {
				const target = await agents.get(profile.name);
				if (!target) return false;
				try {
					const genBefore = (await session.surface(dir)).replaceGeneration;
					await pruneSession(target);
					const input = await compactionInput(target);
					const plan = await planCompaction(input.entries, input.surface, { ...input.opts, tailBudget: 0 });
					if (!plan) return false;
					await runCompaction(target, plan);
					return (await session.surface(dir)).replaceGeneration > genBefore;
				} catch (error) {
					await compactionFailure(target, error);
					return false;
				}
			},
			confirmEscalation: (request: EscalationRequest) =>
				new Promise<EscalationDecision>((resolve) => {
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
						.then(() => rpc.send.escalation_update({}))
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
	agent.setModel(model);
	agent.setThinkingLevel(thinkingLevel);

	if (await promptChangedSinceLastPersist(dir, agent.systemPrompt)) {
		await scope.appendSystemPrompt(agent.systemPrompt, Date.now());
		await recordPrompt(dir, agent.systemPrompt);
	}

	const surf = await session.surface(dir);
	agent.restore(surf.replaceGeneration > 0 ? await session.deriveMessages(dir) : await session.restoreMessages(dir));
	return { profile, dir, scope, agent };
}

type EscalationRequestRecord = NonNullable<Awaited<ReturnType<typeof session.escalationRequest>>>;
type ResumeTurn = NonNullable<Awaited<ReturnType<typeof session.resumeTurn>>>;

async function resumeApprovedEscalation(entry: PartnerAgent, request: EscalationRequestRecord, turn: ResumeTurn) {
	try {
		const { text, exitCode } = await runEscalatedBash(request.command, request.to, { permission: entry.agent.permission });
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

async function compactionInput(entry: PartnerAgent) {
	const settings = await ensureSettings();
	const c = settings.compaction ?? {};
	const entries = await session.rawEntries(entry.dir);
	const surface = await session.surface(entry.dir);
	const header = reconstructRequestHeader(entries);
	return {
		entries,
		surface,
		opts: {
			tailBudget: c.tailBudget ?? 16,
			capChars: c.summaryCapChars ?? 2000,
			summarizer: c.summarizer === "local" ? localSummarizer : createLlmSummarizer(),
			systemPrompt: header?.systemPrompt ?? "",
			tools: header?.tools ?? [],
			model: entry.agent.model ? resolveModel(entry.agent.model) : undefined,
		},
	};
}

async function runCompaction(entry: PartnerAgent, plan: CompactionPlan): Promise<void> {
	await applyCompaction(session, entry.dir, plan);
	entry.agent.restore(await session.deriveMessages(entry.dir));
	rpc.send.trajectory_update({});
}

async function compactionFailure(entry: PartnerAgent, error: unknown): Promise<void> {
	console.error("compact failed:", error);
	try {
		await session.scope(entry.dir).appendCompactionRecord("compaction/end", { ok: false, error: error instanceof Error ? error.message : String(error) }, Date.now());
	} catch {}
}

async function pruneSession(entry: PartnerAgent): Promise<void> {
	const settings = await ensureSettings();
	const entries = await session.rawEntries(entry.dir);
	const surface = await session.surface(entry.dir);
	const prunes = planToolResultPrunes(entries, surface, settings.compaction?.prune ?? {});
	if (prunes.length === 0) return;
	await applyToolResultPrunes(session.scope(entry.dir), surface, prunes);
	console.log(`pruned ${prunes.length} oversized tool results`);
}

async function runManualCompact(entry: PartnerAgent): Promise<{ ok: boolean; error?: string; compacted?: number }> {
	if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
	try {
		await pruneSession(entry);
		const input = await compactionInput(entry);
		const plan = await planCompaction(input.entries, input.surface, input.opts);
		if (!plan) return { ok: true, compacted: 0 };
		await runCompaction(entry, plan);
		return { ok: true, compacted: plan.range.end - plan.range.start + 1 };
	} catch (error) {
		await compactionFailure(entry, error);
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function maybeAutoCompact(entry: PartnerAgent): Promise<void> {
	if (entry.agent.isStreaming) return;
	const settings = await ensureSettings();
	const entries = await session.rawEntries(entry.dir);
	if (hasOrphanCompactionStart(entries)) {
		console.warn("compaction skipped: orphan compaction/start found (previous run may have crashed)");
		return;
	}
	const usage = lastUsage(entries);
	if (!usage) return;
	const window = contextWindow(entry.agent.model ?? undefined);
	const used = usage.input + usage.cacheRead + usage.cacheWrite;
	if (used < window * (settings.compaction?.thresholdRatio ?? 0.8)) return;
	try {
		await pruneSession(entry);
		const input = await compactionInput(entry);
		const plan = await planCompaction(input.entries, input.surface, input.opts);
		if (!plan) return;
		await runCompaction(entry, plan);
		console.log(`auto-compacted ${plan.range.end - plan.range.start + 1} surface nodes`);
	} catch (error) {
		await compactionFailure(entry, error);
	}
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
		runManualCompact: () => runManualCompact(entry),
		resetSession: async () => {
			if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
			try {
				await session.rotateSession(entry.dir);
				entry.agent.reset();
				pendingShellIds.clear();
				rpc.send.shell_update({});
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

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: async ({ text }) => {
				const target = viewPartner;
				if (!target) return { accepted: false };
				const entry = await ensureAgent(target.profile);

				rejectPendingEscalations(target.name, "superseded by a new user message");

				entry.agent.markUserMessage();
				await entry.agent.chat(text);
				return { accepted: true };
			},
			stop: () => {
				void agents.get(viewPartner?.name ?? "")?.then((e) => e.agent.stop());
				return { accepted: true };
			},
			reset: () => {
				void agents.get(viewPartner?.name ?? "")?.then((e) => e.agent.reset());
				return { accepted: true };
			},

			history: async () => {
				const target = viewPartner;
				if (!target) return { items: [] };
				const tRead = performance.now();
				const items = await session.visibleHistory(target.dir);

				for (const item of items) {
					if (item.kind !== "command" || !item.command || item.command.status !== "running") continue;
					if (!pendingCommandIds.has(item.command.commandId)) item.command.status = "interrupted";
				}
				for (const item of items) {
					if (item.kind !== "shell" || !item.command || item.command.status !== "running") continue;
					if (!pendingShellIds.has(item.command.commandId)) item.command.status = "interrupted";
				}
				const tResolve = performance.now();

				for (const item of items) {
					if (item.kind !== "escalation" || !item.escalation || item.escalation.status !== "pending") continue;
					if (pendingSandboxConfirms.has(item.escalation.id)) continue;
					const request = await session.escalationRequest(target.dir, item.escalation.id);
					const resumable = request?.toolCallId ? (await session.resumeTurn(target.dir, request.toolCallId)) !== null : false;
					if (!resumable) item.escalation.status = "dropped";
				}
				const tEnd = performance.now();

				console.log(
					`[timing] bun history: read=${(tResolve - tRead).toFixed(1)}ms escalate=${(tEnd - tResolve).toFixed(1)}ms total=${(tEnd - tRead).toFixed(1)}ms items=${items.length} partner=${target.name}`,
				);
				return { items };
			},

			get_status: async () => {
				const selected = viewPartner ? await agents.get(viewPartner.name) : undefined;
				const partners = await Promise.all(
					[...agents.entries()].map(async ([name, pe]) => {
						const entry = await pe;
						return { name, streaming: entry.agent.isStreaming && pendingEscalationCount(name) === 0, writing: entry.agent.isStreaming || runningCommandPartners.has(name) };
					}),
				);
				const addedProviders = (await loadSettings()).providers ?? [];
				return {
					workspace_path: selected?.agent.workspacePath ? tildify(selected.agent.workspacePath) : null,
					storage_path: selected?.agent.storagePath ? tildify(selected.agent.storagePath) : null,
					sandbox_mode: selected?.agent.sandboxMode ?? "workspace-write",
					model: selected?.agent.model ?? null,
					thinking_level: selected?.agent.thinkingLevel ?? "high",
					thinking_levels: selected ? supportedThinkingLevels(selected.agent.model ?? undefined) : [],
					models: addedProviders.map((p) => ({ provider: p, models: providerModels(p) })),
					partners,
				};
			},
			set_partner_model: async ({ model }) => {
				if (!viewPartner) return { ok: false, error: "no partner selected" };
				const entry = await ensureAgent(viewPartner.profile);
				const normalized = { provider: model.provider, ...(model.modelId ? { modelId: model.modelId } : {}) };
				try {
					entry.agent.setModel(normalized);
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
				await persistModel(entry.dir, { ...normalized, thinkingLevel: entry.agent.thinkingLevel });
				await entry.scope.appendModelChange(normalized, Date.now()).catch((error) => console.error("model_change append failed:", error));
				rpc.send.trajectory_update({});
				return { ok: true };
			},
			set_thinking_level: async ({ level }) => {
				if (!viewPartner) return { ok: false, error: "no partner selected" };
				if (!isThinkingLevel(level)) return { ok: false, error: "invalid level" };
				const entry = await ensureAgent(viewPartner.profile);
				entry.agent.setThinkingLevel(level);
				await persistModel(entry.dir, {
					provider: entry.agent.model?.provider ?? "deepseek",
					...(entry.agent.model?.modelId ? { modelId: entry.agent.model.modelId } : {}),
					thinkingLevel: level,
				});
				await entry.scope.appendThinkingLevelChange(level, Date.now()).catch((error) => console.error("thinking_level_change append failed:", error));
				rpc.send.thinking_level_update({});
				rpc.send.trajectory_update({});
				return { ok: true };
			},
			set_sandbox_mode: async ({ mode }) => {
				if (!viewPartner) return { ok: false, error: "no partner selected" };
				if (!isSandboxMode(mode)) return { ok: false, error: "invalid mode" };
				const entry = await ensureAgent(viewPartner.profile);
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
				rpc.send.escalation_update({});
				if (resume) void resumeApprovedEscalation(resume.entry, resume.request, resume.turn);
				return { ok: true };
			},
			surface: async () => {
				const target = viewPartner;
				if (!target) return { nodes: [], replaceGeneration: 0 };
				return session.surface(target.dir);
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
				return runManualCompact(entry);
			},
			commands_list: async () => ({ commands: commandRegistry.list() }),
			commands_execute: async ({ line }) => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				if (!target || !entry) return { ok: false, error: "no partner selected" };
				if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
				if (runningCommandPartners.has(target.name)) return { ok: false, error: "command is running" };
				const ctx = commandContextFor(entry);
				try {
					const execution = await commandRegistry.execute(line, ctx);
					if (!execution) return { ok: false, error: "unknown command" };
					return { ok: true, commandId: execution.commandId, result: execution.result };
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
					const result = await runEscalatedBash(command, mode, { permission: entry.agent.permission }, timeout);
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

			context_usage: async () => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				return projectSnapshot(entry?.agent.context ?? new Context(), {
					session,
					dir: target?.dir ?? null,
					systemPrompt: entry?.agent.systemPrompt,
					tools: entry?.agent.tools,
				});
			},
			trajectory: async ({ name, before, limit = 200, surfaceOnly = false }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { records: [], hasMore: false, total: 0 };
				const dir = getPartnerDir(settings, name);
				const allRecords = fold(await session.rawEntries(dir));
				const total = allRecords.length;
				// Header dedup is a display rule (tool-set content repeats across steps); it lives
				// server-side so paging cannot resurrect a header that was already deduplicated.
				let records = dedupeRequestHeaders(allRecords);
				if (surfaceOnly) {
					try {
						const surface = await session.surface(dir);
						const ids = new Set(surface.nodes.map((n) => n.id));
						records = records.filter((r) => ids.has(r.entryId));
					} catch {
						// Surface fold can fail mid-compaction; fall back to the whole log instead of an empty view.
					}
				}
				let end = records.length;
				if (before != null) {
					const i = records.findIndex((r) => r.seq >= before);
					if (i !== -1) end = i;
				}
				let start = Math.max(0, end - limit);
				// Align the page start to a natural boundary (a user question or an assistant reply),
				// so the top of the loaded window isn't a mid-turn marker like request/header.
				while (start > 0 && records[start].kind !== "user" && records[start].kind !== "assistant") {
					start--;
				}
				return { records: records.slice(start, end), hasMore: start > 0, total };
			},
			partner_activity: async ({ name, weeks }) => {
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { days: [] };
				return { days: dailyActivity(await session.rawEntries(getPartnerDir(settings, name)), weeks) };
			},
			stats: async () => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				const usage = target ? aggregateUsage(await session.rawEntries(target.dir)) : null;
				return { usage, runtime: entry?.agent.runtimeStats ?? { runs: 0, avgTtftMs: null, avgTps: null, lastTtftMs: null } };
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
					void armSkillsWatchers();
					for (const removed of prevProviders.filter((p) => !nextProviders.includes(p))) {
						await deleteApiKey(removed);
					}
					for (const def of nextDefs) registerCustomProvider(def);
					for (const gone of prevDefs.filter((d) => !nextDefs.some((n) => n.id === d.id))) {
						unregisterCustomProvider(gone.id);
					}
					await reloadCommands();
					return { ok: true };
				} catch (error) {
					console.error("update_settings failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			list_partners: async () => {
				const settings = await loadSettings();
				const profiles = await listPartners(settings);

				const partners = await Promise.all(
					profiles.map(async (profile) => {
						const last = await session.lastMessage(getPartnerDir(settings, profile.name));
						const lastMessageKind: "user" | "send_message" = last?.kind === "user" ? "user" : "send_message";
						const readAt = await readPartnerReadAt(getPartnerDir(settings, profile.name));
						return last ? { ...profile, lastMessage: last.text, lastMessageAt: last.time, lastMessageKind, readAt } : { ...profile, readAt };
					}),
				);
				return { partners };
			},
			create_partner: async (input) => {
				try {
					const settings = await loadSettings();
					const profile = await createPartner(settings, input);

					const providers = settings.providers ?? [];
					const first = providers[0] ? providerModels(providers[0])[0] : undefined;
					if (first) {
						const entry = await ensureAgent(profile);
						const pin = { provider: providers[0], modelId: first.id };
						entry.agent.setModel(pin);
						await persistModel(entry.dir, pin);
					}
					return { ok: true, profile };
				} catch (error) {
					if (error instanceof PartnerError) return { ok: false, error: error.message };
					console.error("create_partner failed:", error);
					return { ok: false, error: "Failed to create partner" };
				}
			},

			set_partner: async ({ profile }) => {
				if (profile) {
					const dir = await partnerDirFor(profile.name);
					viewPartner = { name: profile.name, dir, profile };
					await ensureAgent(profile);

					rpc.send.workspace_update({});
					void armSkillsWatchers();
				} else {
					viewPartner = null;
					void armSkillsWatchers();
				}
				return { ok: true };
			},
			delete_partner: async ({ name }) => {
				try {
					const settings = await loadSettings();
					await deletePartner(settings, name);

					session.evictRoot(getPartnerDir(settings, name));
					agents.delete(name);
					if (viewPartner?.name === name) viewPartner = null;
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

ApplicationMenu.setApplicationMenu([
	{
		label: "LETTERS",
		submenu: [{ role: "about" }, { type: "divider" }, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "divider" }, { role: "quit" }],
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
		submenu: [{ role: "minimize" }, { role: "zoom" }],
	},
]);

armCommandsWatch(commandsDir(startupSettings));
void armSkillsWatchers();

new BrowserWindow({
	title: "Coding",

	titleBarStyle: "hiddenInset",
	url: "views://mainview/index.html",
	rpc,
	frame: {
		width: 1200,
		height: 800,
		x: 120,
		y: 60,
	},
});

console.log("\x1b[32mletters started — agent ready\x1b[0m");
