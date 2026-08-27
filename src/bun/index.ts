import { homedir } from "node:os";
import { sep } from "node:path";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { type AgentHandle, createAgent } from "./core/agent";
import {
	contextWindow,
	providerBaseUrl,
	providerModels,
	registerCustomProvider,
	supportedThinkingLevels,
	unregisterCustomProvider,
	validateCustomProviders,
} from "./core/agent-config";
import { applyCompaction, type CompactionPlan, planCompaction } from "./core/compaction";
import { loadRuntimeStats, saveRuntimeStats } from "./core/runtime-stats";
import { priceSurface } from "./core/token-meter";
import { aggregateUsage, fold, lastUsage } from "./core/trajectory";
import { deleteApiKey, getApiKey, loadCredentials, setApiKey } from "./lib/credentials";
import { ensureModel, ensureSandboxMode, ensureStoragePath, ensureWorkspace, isThinkingLevel } from "./lib/ensure";
import { partnerDirFor, persistModel, persistSandboxMode, persistWorkspace, promptChangedSinceLastPersist, recordPrompt } from "./lib/partner-files";
import { getPartnerDir, loadSettings, saveSettings } from "./lib/settings";
import { createPartner, deletePartner, listPartners, PartnerError, type PartnerInput } from "./partners";
import type { EscalationDecision, EscalationRequest, SandboxMode } from "./permission";
import { isSandboxMode, SandboxManager } from "./permission";
import { createSessionStore, type SessionScope } from "./persist";
import { runEscalatedBash } from "./tools";

// Api keys load from .credentials.yaml once at startup (settings only lists which providers are added).
await loadCredentials();
for (const def of (await loadSettings()).customProviders ?? []) registerCustomProvider(def);

const session = createSessionStore();
const sandbox = new SandboxManager();
const pendingSandboxConfirms = new Map<string, { resolve: (decision: EscalationDecision) => void; to: SandboxMode; dir: string; partner: string }>();
// Escalation ids already decided this session — a repeated sandbox_respond (double-click) or a late
// click on an already-decided bubble must not persist a second decision record.
const respondedSandboxIds = new Set<string>();
// Launch nonce: the request/decision records persist across restarts and are matched BY ID — a plain
// counter reset on restart would reuse ids (sbx-1 twice in one log) and cross-contaminate decisions.
const escalationNonce = Date.now().toString(36);
let sandboxConfirmSeq = 0;

interface PartnerAgent {
	profile: PartnerInput;
	dir: string;
	scope: SessionScope;
	agent: AgentHandle;
}
// The partner the view is showing (selection ≠ run owner: every partner runs independently)
let viewPartner: { name: string; dir: string; profile: PartnerInput } | null = null;
// Promise-valued: creation is async and first touches race (select + first send) — storing the
// in-flight creation lets concurrent callers await one promise instead of double-creating.
const agents = new Map<string, Promise<PartnerAgent>>();

function pendingEscalationCount(partner: string): number {
	let n = 0;
	for (const pending of pendingSandboxConfirms.values()) {
		if (pending.partner === partner) n += 1;
	}
	return n;
}

/**
 * Claim + reject every escalation of `partner` still awaiting the human: resolve rejected (so the
 * blocked run settles and queued follow-ups can drain), persist the decision, and mark the ids
 * responded (a racing click must not double-decide). Callers: agent_end (the run died) and chat
 * (a new user message supersedes pending approvals).
 */
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

/** Create the partner's agent on first interaction — idempotent; it lives until the partner is deleted. */
function ensureAgent(profile: PartnerInput): Promise<PartnerAgent> {
	const existing = agents.get(profile.name);
	if (existing) return existing;
	// A failed creation must remove itself, or the rejected promise would poison every later call.
	const created = createPartnerAgent(profile).catch((error) => {
		if (agents.get(profile.name) === created) agents.delete(profile.name);
		throw error;
	});
	agents.set(profile.name, created);
	return created;
}

async function createPartnerAgent(profile: PartnerInput): Promise<PartnerAgent> {
	const dir = await partnerDirFor(profile.name);
	// Storage: partner-scoped directory the agent may freely write to; must exist before the prompt mentions it
	const storagePath = await ensureStoragePath(dir);
	// Restore the persisted workspace (per-partner): re-validated so a deleted directory is not restored
	const workspace = await ensureWorkspace(dir);
	// Permission setting: the default sandbox mode captured for a fresh partner.
	const settings = await loadSettings();
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
			onWorkspaceUpdate: () => rpc.send.workspace_update({}),
			onWorkspaceSet: (path) => void persistWorkspace(dir, path),
			onEnd: (error) => {
				// Any escalation still awaiting the human dies with the run — a late click must never
				// grant a run that is already gone.
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
			confirmEscalation: (request: EscalationRequest) =>
				new Promise<EscalationDecision>((resolve) => {
					const id = `sbx-${escalationNonce}-${++sandboxConfirmSeq}`;
					pendingSandboxConfirms.set(id, { resolve, to: request.to, dir, partner: profile.name });
					// Persist the request first — the transcript/trajectory render from the origin log, not a push
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
							// The bubble can never render — the run would hang invisibly on the human gate; drop it as rejected
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
	// Persist the rebuilt prompt so the trajectory view can show it — per root, and only when it
	// actually changed; the hash record is file-backed so restarts don't pile up identical entries
	if (await promptChangedSinceLastPersist(dir, agent.systemPrompt)) {
		await scope.appendSystemPrompt(agent.systemPrompt, Date.now());
		await recordPrompt(dir, agent.systemPrompt);
	}
	// Restore the model chain from the surface once compaction has rewritten it (replaceGeneration > 0);
	// append-only sessions keep the buildSessionContext path (identical output, includes dangling-turn repair).
	const surf = await session.surface(dir);
	agent.restore(surf.replaceGeneration > 0 ? await session.deriveMessages(dir) : await session.restoreMessages(dir));
	return { profile, dir, scope, agent };
}

type EscalationRequestRecord = NonNullable<Awaited<ReturnType<typeof session.escalationRequest>>>;
type ResumeTurn = NonNullable<Awaited<ReturnType<typeof session.resumeTurn>>>;

/**
 * Resume a persisted escalation after a restart: run the approved command under the granted mode,
 * insert the tool result into the restored context (the dangling turn kept; queued follow-up user
 * messages after it stay after it), persist the result, and continue the run from the tool result.
 */
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
		// The blocked turn is already in the log (persisted at message_end, before the gate) — only the result lands here
		entry.agent.restore([...turn.messages.slice(0, turn.insertAt), result, ...turn.messages.slice(turn.insertAt)]);
		await entry.scope.appendToolResult(result, Date.now());
		await entry.agent.continue();
	} catch (error) {
		console.error("resumeApprovedEscalation failed:", error);
	}
}

/** Compaction threshold: auto-compact after a settled run when provider usage exceeds this fraction of the window. */
const COMPACT_THRESHOLD = 0.7;

async function runCompaction(entry: PartnerAgent, plan: CompactionPlan): Promise<void> {
	await applyCompaction(session, entry.dir, plan);
	entry.agent.restore(await session.deriveMessages(entry.dir));
	rpc.send.trajectory_update({});
}

async function maybeAutoCompact(entry: PartnerAgent): Promise<void> {
	if (entry.agent.isStreaming) return;
	const entries = await session.rawEntries(entry.dir);
	const usage = lastUsage(entries);
	if (!usage) return;
	const window = contextWindow(entry.agent.model ?? undefined);
	const used = usage.input + usage.cacheRead + usage.cacheWrite;
	if (used < window * COMPACT_THRESHOLD) return;
	try {
		const surface = await session.surface(entry.dir);
		const plan = planCompaction(entries, surface);
		if (!plan) return;
		await runCompaction(entry, plan);
		console.log(`auto-compacted ${plan.range.end - plan.range.start + 1} surface nodes`);
	} catch (error) {
		console.error("auto-compact failed:", error);
	}
}

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: async ({ text }) => {
				const target = viewPartner;
				if (!target) return { accepted: false };
				const entry = await ensureAgent(target.profile);
				// A new user message supersedes any pending escalations of THIS partner: the human is
				// engaging, not approving — reject them so the blocked run settles and the queued
				// follow-up can drain (without this, the new question waits indefinitely on the gate).
				rejectPendingEscalations(target.name, "superseded by a new user message");
				// Reset the progress-notification clock at SEND time (not when the queued message is
				// processed): a follow-up behind the partner's own running turn must restart the
				// "working ~Ns" countdown immediately.
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
			// The view actively pulls history after mounting (avoids the startup race: pushes may be lost before the view is ready)
			history: async () => {
				const target = viewPartner;
				if (!target) return { items: [] };
				const tRead = performance.now();
				const items = await session.visibleHistory(target.dir);
				const tResolve = performance.now();
				// A pending request with no live promise is only actionable when its blocked tool call
				// still exists in the log (restart-resume); otherwise it is orphaned — render as
				// "dropped" (no buttons) so a click can never pretend a decision ran a dead request.
				for (const item of items) {
					if (item.kind !== "escalation" || !item.escalation || item.escalation.status !== "pending") continue;
					if (pendingSandboxConfirms.has(item.escalation.id)) continue;
					const request = await session.escalationRequest(target.dir, item.escalation.id);
					const resumable = request?.toolCallId ? (await session.resumeTurn(target.dir, request.toolCallId)) !== null : false;
					if (!resumable) item.escalation.status = "dropped";
				}
				const tEnd = performance.now();
				// Timing probe: where does loading a large history spend its time? (read vs escalation resolve)
				console.log(
					`[timing] bun history: read=${(tResolve - tRead).toFixed(1)}ms escalate=${(tEnd - tResolve).toFixed(1)}ms total=${(tEnd - tRead).toFixed(1)}ms items=${items.length} partner=${target.name}`,
				);
				return { items };
			},
			// The bun-side ground truth: per-partner streaming (view-facing: an escalation-paused run
			// reads idle — the run is paused on the approval gate, not generating) + the selected chat's
			// workspace/sandbox. The view calibrates idle rendering with it.
			get_status: async () => {
				const selected = viewPartner ? await agents.get(viewPartner.name) : undefined;
				const partners = await Promise.all(
					[...agents.entries()].map(async ([name, pe]) => {
						const entry = await pe;
						return { name, streaming: entry.agent.isStreaming && pendingEscalationCount(name) === 0 };
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
				// Claim synchronously on first click: a double-click must not write a second decision
				// record, and a racing agent_end must not resolve the same entry twice.
				if (respondedSandboxIds.has(id)) return { ok: true };
				respondedSandboxIds.add(id);
				const pending = pendingSandboxConfirms.get(id);
				if (pending) pendingSandboxConfirms.delete(id);
				// Persisted (restart) escalation: approving must still execute the command and continue
				// the task — but only while the blocked turn is resumable; otherwise fail closed (a
				// decision claiming "approved" while nothing runs would be the misleading case).
				let resume: { entry: PartnerAgent; request: EscalationRequestRecord; turn: ResumeTurn } | null = null;
				if (!pending && approved) {
					const target = viewPartner;
					const entry = target ? await ensureAgent(target.profile) : undefined;
					// Idle only: restoring over a live run would yank the active context out from under it
					if (entry && !entry.agent.isStreaming) {
						const request = await session.escalationRequest(entry.dir, id);
						const turn = request?.toolCallId ? await session.resumeTurn(entry.dir, request.toolCallId) : null;
						if (request && turn) {
							resume = { entry, request, turn };
						} else {
							approved = false; // unresumable — record the decision as rejected
						}
					} else {
						approved = false;
					}
				}
				// Persist the decision BEFORE resolving: the grant must not outrun the log, and a failed
				// persist must not run the command — the pending run is rejected, never hung.
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
					respondedSandboxIds.delete(id); // allow a retry (nothing was decided)
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
			compact: async () => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				if (!target || !entry) return { ok: false, error: "no partner selected" };
				if (entry.agent.isStreaming) return { ok: false, error: "agent is running" };
				const entries = await session.rawEntries(target.dir);
				const surface = await session.surface(target.dir);
				const plan = planCompaction(entries, surface);
				if (!plan) return { ok: true, compacted: 0 };
				await runCompaction(entry, plan);
				return { ok: true, compacted: plan.range.end - plan.range.start + 1 };
			},
			// Context occupancy for the composer meter: used = last turn's provider-reported prompt size
			// (input + cacheRead + cacheWrite, no output), window = the routed model's contextWindow.
			// breakdown is the surface-priced composition (4 chars ≈ 1 token), always labeled `~` in the UI.
			context_usage: async () => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				const entries = target ? await session.rawEntries(target.dir) : [];
				const surface = target ? await session.surface(target.dir) : { nodes: [], replaceGeneration: 0 };
				const usage = lastUsage(entries);
				const used = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
				const window = contextWindow(entry?.agent.model ?? undefined);
				const percent = used === 0 ? 0 : Math.min(100, Math.round((used / window) * 100));
				return {
					used,
					window,
					percent,
					breakdown: entry ? priceSurface(entry.agent.systemPrompt, entry.agent.tools, entries, surface) : null,
					lastTurn: usage ?? undefined,
				};
			},
			trajectory: async ({ name }) => {
				// Explicit partner name (not viewPartner): the drawer may open/fetch while a partner
				// switch is still settling, and viewPartner can lag behind the selection — resolving
				// by name keeps trajectory tied to the same chat the message list shows.
				const settings = await loadSettings();
				const profile = (await listPartners(settings)).find((p) => p.name === name);
				if (!profile) return { records: [] };
				return { records: fold(await session.rawEntries(getPartnerDir(settings, name))) };
			},
			stats: async () => {
				const target = viewPartner;
				const entry = target ? await agents.get(target.name) : undefined;
				const usage = target ? aggregateUsage(await session.rawEntries(target.dir)) : null;
				return { usage, runtime: entry?.agent.runtimeStats ?? { runs: 0, avgTtftMs: null, avgTps: null, lastTtftMs: null } };
			},
			get_settings: async () => {
				const settings = await loadSettings();
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
					for (const removed of prevProviders.filter((p) => !nextProviders.includes(p))) {
						await deleteApiKey(removed);
					}
					for (const def of nextDefs) registerCustomProvider(def);
					for (const gone of prevDefs.filter((d) => !nextDefs.some((n) => n.id === d.id))) {
						unregisterCustomProvider(gone.id);
					}
					return { ok: true };
				} catch (error) {
					console.error("update_settings failed:", error);
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			list_partners: async () => {
				const settings = await loadSettings();
				const profiles = await listPartners(settings);
				// Each row shows the partner's last visible message; read it per partner dir so the
				// list preview stays current even for chats that are not selected (isolation by dir).
				const partners = await Promise.all(
					profiles.map(async (profile) => {
						const last = await session.lastMessage(getPartnerDir(settings, profile.name));
						const lastMessageKind: "user" | "send_message" = last?.kind === "user" ? "user" : "send_message";
						return last ? { ...profile, lastMessage: last.text, lastMessageAt: last.time, lastMessageKind } : profile;
					}),
				);
				return { partners };
			},
			create_partner: async (input) => {
				try {
					const settings = await loadSettings();
					const profile = await createPartner(settings, input);
					// A fresh partner has no model pin: default it to the first provider's first
					// catalog model, so the composer's model select shows a real selection, not a blank.
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
			// The view's selection: no deferral needed — every partner runs on its own agent, so the
			// switch is instant (only the transcript shown changes). The agent is created on demand.
			set_partner: async ({ profile }) => {
				if (profile) {
					const dir = await partnerDirFor(profile.name);
					viewPartner = { name: profile.name, dir, profile };
					await ensureAgent(profile);
					// The selection changed: the composer's workspace/sandbox chip must show the new partner's values
					rpc.send.workspace_update({});
				} else {
					viewPartner = null;
				}
				return { ok: true };
			},
			delete_partner: async ({ name }) => {
				try {
					const settings = await loadSettings();
					await deletePartner(settings, name);
					// Drop the cached session root so a recreated same-name partner starts empty
					// (the store would otherwise keep the old in-memory session and replay its history) —
					// and drop the agent: its context dies with the partner.
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
		},
		messages: {
			history_timing: ({ partner, rpcMs, buildMs, renderMs, items }) => {
				// Timing probe (view-reported): RPC round-trip vs batch-build vs single commit render
				console.log(
					`[timing] view history: rpc=${rpcMs.toFixed(1)}ms build=${buildMs.toFixed(1)}ms render=${renderMs.toFixed(1)}ms total=${(rpcMs + buildMs + renderMs).toFixed(1)}ms items=${items} partner=${partner}`,
				);
			},
		},
	},
});

// Standard macOS menu. Without an Edit menu, the webview's native text
// editing (Cmd+C/V/X, right-click paste) has no responder to route to.
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

new BrowserWindow({
	title: "Coding",
	// IDE-style: no title text; traffic lights overlay the view,
	// whose top strip is a drag region (see index.html).
	titleBarStyle: "hiddenInset",
	url: "views://mainview/index.html",
	rpc,
	frame: {
		// 1200×800: letter column ~538px (≈55ch comfortable reading), transcript shows ~2 more messages; fits 1440×900+ screens
		width: 1200,
		height: 800,
		x: 120,
		y: 60,
	},
});

// ANSI green — one line, not worth a chalk dependency
console.log("\x1b[32mletters started — agent ready\x1b[0m");
