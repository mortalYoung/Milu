import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { createAgent, validateWorkspace } from "./core/agent";
import { contextWindow } from "./core/agent-config";
import { applyCompaction, type CompactionPlan, planCompaction } from "./core/compaction";
import { DATABASE_ROOT } from "./core/config";
import { loadRuntimeStats, saveRuntimeStats } from "./core/runtime-stats";
import { createSessionStore } from "./core/session";
import { priceSurface } from "./core/token-meter";
import { aggregateUsage, fold, lastUsage } from "./core/trajectory";
import { createPartner, deletePartner, listPartners, loadSettings, PartnerError, partnerDir, partnerRoot, saveSettings } from "./partners";
import { SandboxManager } from "./sandbox";
import type { EscalationDecision, EscalationRequest, SandboxMode } from "./sandbox/types";
import { runEscalatedBash, TOOL_GUIDANCE } from "./tools";

// Session persistence: isolated per Partner directory; chatting is disabled while no Partner is selected
const session = createSessionStore();
// Sandbox: per-platform backend registry (macOS → seatbelt); fail closed when no backend is usable
const sandbox = new SandboxManager();
// Pending escalation decisions awaiting the human (view dialog → sandbox_respond RPC)
const pendingSandboxConfirms = new Map<string, { resolve: (decision: EscalationDecision) => void; to: SandboxMode }>();
// Escalation ids already decided this session — a repeated sandbox_respond (double-click) or a late
// click on an already-decided bubble must not persist a second decision record.
const respondedSandboxIds = new Set<string>();
// Launch nonce: the request/decision records persist across restarts and are matched BY ID — a plain
// counter reset on restart would reuse ids (sbx-1 twice in one log) and cross-contaminate decisions.
const escalationNonce = Date.now().toString(36);
let sandboxConfirmSeq = 0;

/**
 * Claim + reject every escalation still awaiting the human: resolve rejected (so the blocked run
 * settles and queued follow-ups can drain), persist the decision, and mark the ids responded (a
 * racing click must not double-decide). Callers: agent_end (the run died) and chat (a new user
 * message supersedes pending approvals).
 */
function rejectPendingEscalations(reason: string) {
	if (pendingSandboxConfirms.size === 0) return;
	const timestamp = Date.now();
	for (const [id, pending] of pendingSandboxConfirms) {
		pendingSandboxConfirms.delete(id);
		respondedSandboxIds.add(id);
		pending.resolve({ approved: false, reason });
		void session
			.appendEscalationRecord("escalation/decision", { escalationId: id, approved: false }, timestamp)
			.catch((error) => console.error("escalation decision failed:", error));
	}
	rpc.send.escalation_update({});
}
let currentPartner: { name: string; dir: string } | null = null;
// The partner whose run is currently in progress (set when a run starts, cleared on agent_end);
// the view uses it to show the writing/stop state only for that partner, not for every partner.
let runningPartner: string | null = null;
// A partner switch requested while a run is in flight: applied when the run settles, so the run's
// session root and agent context stay intact (a mid-run switch would yank both out from under it).
let pendingSwitch: { name: string; responsibilities?: string; tones?: string } | null = null;
// Cross-partner messages queued while another partner's run is in flight: each starts a fresh run
// for its own partner once the current run settles — never a follow-up into the wrong run.
const pendingChats: { text: string; partner: string }[] = [];
// Prompt persistence dedup: the prompt is static, and an in-memory guard resets on every restart
// (one system_prompt appended per launch, piling up identical entries). Record the last persisted
// prompt hash per root on disk so restarts stay silent until the prompt actually changes.
const lastPromptPath = (dir: string) => join(dir, "last-prompt.json");
const promptHash = (prompt: string) => createHash("sha256").update(prompt).digest("hex");
async function promptChangedSinceLastPersist(dir: string, prompt: string): Promise<boolean> {
	try {
		const saved = JSON.parse(await readFile(lastPromptPath(dir), "utf8")) as { hash?: unknown };
		return saved.hash !== promptHash(prompt);
	} catch {
		return true; // no record yet (first selection of this root)
	}
}
async function recordPrompt(dir: string, prompt: string): Promise<void> {
	await writeFile(lastPromptPath(dir), JSON.stringify({ hash: promptHash(prompt) }, null, 2), "utf8");
}

/** Display helper: render the home directory as ~ (…/Users/xiuneng/… → ~/…) for the composer chip. */
function tildify(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(home + sep)) return `~${path.slice(home.length)}`;
	return path;
}

// Workspace persistence: per-partner file (survives restart; re-validated on restore).
const workspaceFilePath = (dir: string) => join(dir, "workspace.json");
async function persistWorkspace(path: string) {
	if (!currentPartner) return;
	try {
		await writeFile(workspaceFilePath(currentPartner.dir), JSON.stringify({ path }, null, 2), "utf8");
	} catch (error) {
		console.error("persistWorkspace failed:", error);
	}
}

// Sandbox mode persistence: per-partner file (survives restart; re-validated on restore).
const sandboxFilePath = (dir: string) => join(dir, "sandbox.json");
const SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
function isSandboxMode(value: unknown): value is SandboxMode {
	return typeof value === "string" && (SANDBOX_MODES as string[]).includes(value);
}
async function persistSandboxMode(mode: SandboxMode) {
	if (!currentPartner) return;
	try {
		await writeFile(sandboxFilePath(currentPartner.dir), JSON.stringify({ mode }, null, 2), "utf8");
	} catch (error) {
		console.error("persistSandboxMode failed:", error);
	}
}

const agent = createAgent(
	{
		onTurnStart: (turn) => rpc.send.agent_turn({ turn, partner: runningPartner }),
		// send_message is already in the store; here we only signal the view to refetch
		onMessage: () => rpc.send.agent_message({}),
		// A turn has been persisted; the view invalidates its trajectory cache and refetches
		onTrajectoryUpdate: () => rpc.send.trajectory_update({}),
		// The workspace was set; the view refetches status and shows it near the input
		onWorkspaceUpdate: () => rpc.send.workspace_update({}),
		// …and it was accepted: persist it per-partner so it survives restart
		onWorkspaceSet: (path) => void persistWorkspace(path),
		onEnd: (error) => {
			runningPartner = null;
			// Any escalation still awaiting the human dies with the run — a late click must never
			// grant a run that is already gone.
			rejectPendingEscalations("run ended while awaiting approval");
			rpc.send.agent_end({ error });
			void drainQueued().finally(() => void maybeAutoCompact());
		},
	},
	{
		session,
		// Runtime timing is process-global: seed from disk on launch, write through after every sampled turn
		runtimeStats: await loadRuntimeStats(DATABASE_ROOT),
		persistRuntimeStats: (snapshot) => void saveRuntimeStats(DATABASE_ROOT, snapshot).catch((error) => console.error("saveRuntimeStats failed:", error)),
		sandbox,
		// Human approval gate for escalation retries: push to the view, await the sandbox_respond reply
		confirmEscalation: (request: EscalationRequest) =>
			new Promise<EscalationDecision>((resolve) => {
				const id = `sbx-${escalationNonce}-${++sandboxConfirmSeq}`;
				pendingSandboxConfirms.set(id, { resolve, to: request.to });
				// Persist the request first — the transcript/trajectory render from the origin log, not a push
				void session
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

type EscalationRequestRecord = NonNullable<Awaited<ReturnType<typeof session.escalationRequest>>>;
type ResumeTurn = NonNullable<Awaited<ReturnType<typeof session.resumeTurn>>>;

/**
 * Resume a persisted escalation after a restart: run the approved command under the granted mode,
 * insert the tool result into the restored context (the dangling turn kept; queued follow-up user
 * messages after it stay after it), persist the result, and continue the run from the tool result.
 */
async function resumeApprovedEscalation(target: { name: string; dir: string }, request: EscalationRequestRecord, turn: ResumeTurn) {
	try {
		const { text, exitCode } = await runEscalatedBash(request.command, request.to, {
			guard: { workspaceRoot: () => agent.workspacePath, storageRoot: () => agent.storagePath },
			sandbox: { manager: sandbox, getMode: () => request.to },
		});
		const result: ToolResultMessage = {
			role: "toolResult",
			toolCallId: request.toolCallId,
			toolName: "bash",
			content: [{ type: "text", text }],
			isError: exitCode !== 0 && exitCode !== undefined,
			timestamp: Date.now(),
		};
		const inserted = turn.turn ? [turn.turn, result] : [result]; // log case: the turn is already in messages
		agent.restore([...turn.messages.slice(0, turn.insertAt), ...inserted, ...turn.messages.slice(turn.insertAt)]);
		await session.appendToolResult(result, Date.now());
		if (!agent.isStreaming) runningPartner = target.name;
		await agent.continue();
	} catch (error) {
		console.error("resumeApprovedEscalation failed:", error);
	}
}

/** The partner the view is showing right now: the pending switch when one is deferred, else the applied one. */
async function effectivePartner(): Promise<{ name: string; dir: string } | null> {
	if (pendingSwitch) {
		const settings = await loadSettings();
		return { name: pendingSwitch.name, dir: join(partnerRoot(settings), pendingSwitch.name) };
	}
	return currentPartner;
}

/** Switch the active partner (session root, prompt, storage, workspace, restore). Only called while the agent is idle. */
async function applyPartnerSwitch(profile: { name: string; responsibilities?: string; tones?: string } | null): Promise<void> {
	if (profile) {
		const settings = await loadSettings();
		currentPartner = { name: profile.name, dir: join(partnerRoot(settings), profile.name) };
		await session.setRoot(currentPartner.dir);
		agent.setPartner(profile);
		// Storage: partner-scoped directory the agent may freely write to; must exist before the prompt mentions it
		const storagePath = join(currentPartner.dir, "storage");
		await mkdir(storagePath, { recursive: true });
		agent.setStoragePath(storagePath);
		// Restore the persisted workspace (per-partner): re-validated so a deleted directory is not restored.
		// Always applied (null when this partner has none) — otherwise the previous partner's workspace
		// would leak into this one after a switch.
		let workspace: string | null = null;
		try {
			const raw = await readFile(workspaceFilePath(currentPartner.dir), "utf8");
			const saved = JSON.parse(raw) as { path?: unknown };
			if (typeof saved.path === "string" && validateWorkspace(saved.path, { current: null, storagePath }) === null) {
				workspace = saved.path;
			}
		} catch {
			// no persisted workspace for this partner
		}
		agent.setWorkspace(workspace);
		// Restore the per-partner sandbox mode (persisted; fallback default) — never leak another partner's
		let mode: SandboxMode = "workspace-write";
		try {
			const raw = await readFile(sandboxFilePath(currentPartner.dir), "utf8");
			const saved = JSON.parse(raw) as { mode?: unknown };
			if (isSandboxMode(saved.mode)) mode = saved.mode;
		} catch {
			// no persisted mode for this partner
		}
		agent.setSandboxMode(mode);
		// Persist the rebuilt prompt so the trajectory view can show it — per root, and only when it
		// actually changed; the hash record is file-backed so restarts don't pile up identical entries
		if (await promptChangedSinceLastPersist(currentPartner.dir, agent.systemPrompt)) {
			await session.appendSystemPrompt(agent.systemPrompt, Date.now());
			await recordPrompt(currentPartner.dir, agent.systemPrompt);
		}
		// Restore the model chain from the surface once compaction has rewritten it (replaceGeneration > 0);
		// append-only sessions keep the buildSessionContext path (identical output, includes dangling-turn repair).
		const surf = await session.surface(currentPartner.dir);
		const restored = surf.replaceGeneration > 0 ? await session.deriveMessages(currentPartner.dir) : await session.restoreMessages(currentPartner.dir);
		agent.restore(restored);
	} else {
		currentPartner = null;
		agent.setPartner(null);
		agent.setStoragePath(null);
		agent.setWorkspace(null);
		agent.setSandboxMode("workspace-write");
	}
}

/**
 * After a run settles: apply the deferred partner switch, then start fresh runs for queued
 * cross-partner messages — each in its own partner's session, never merged into the prior run.
 */
async function drainQueued() {
	if (pendingSwitch) {
		const profile = pendingSwitch;
		pendingSwitch = null;
		await applyPartnerSwitch(profile);
	}
	while (!agent.isStreaming && pendingChats.length > 0) {
		const next = pendingChats[0];
		if (next.partner !== currentPartner?.name) break; // selection moved on; stays queued until it returns
		pendingChats.shift();
		runningPartner = next.partner;
		await agent.chat(next.text);
	}
}

/** Compaction threshold: auto-compact after a settled run when provider usage exceeds this fraction of the window. */
const COMPACT_THRESHOLD = 0.7;

/** Apply a compaction plan, sync the agent's in-memory chain to the compacted surface, and notify the view. */
async function runCompaction(target: { dir: string }, plan: CompactionPlan): Promise<void> {
	await applyCompaction(session, target.dir, plan);
	agent.restore(await session.deriveMessages(target.dir));
	rpc.send.trajectory_update({}); // invalidates the trajectory cache and refreshes the context meter
}

/** Auto-compact after a run settles: only when the agent is idle and usage crossed the threshold. */
async function maybeAutoCompact(): Promise<void> {
	if (agent.isStreaming) return;
	const target = await effectivePartner();
	if (!target) return;
	const entries = await session.rawEntries(target.dir);
	const usage = lastUsage(entries);
	if (!usage) return;
	const window = contextWindow();
	const used = usage.input + usage.cacheRead + usage.cacheWrite;
	if (used < window * COMPACT_THRESHOLD) return;
	try {
		const surface = await session.surface(target.dir);
		const plan = planCompaction(entries, surface);
		if (!plan) return;
		await runCompaction(target, plan);
		console.log(`auto-compacted ${plan.range.end - plan.range.start + 1} surface nodes`);
	} catch (error) {
		console.error("auto-compact failed:", error);
	}
}

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: async ({ text }) => {
				// The message targets the view's selection — the pending switch (deferred mid-run)
				// is that selection, so a message sent from its chat belongs to the pending partner.
				const target = pendingSwitch ?? currentPartner;
				if (!target) return { accepted: false };
				// A new user message supersedes any pending escalations: the human is engaging, not
				// approving — reject them so the blocked run settles and the queued follow-up can drain
				// (without this, the new question waits indefinitely on the approval gate).
				rejectPendingEscalations("superseded by a new user message");
				// Reset the progress-notification clock at SEND time (not when the queued message is
				// processed): a question queued behind another run must restart the "working ~Ns"
				// countdown immediately, otherwise reminders keep counting from the previous question.
				agent.markUserMessage();
				if (pendingSwitch || (agent.isStreaming && runningPartner !== null && runningPartner !== target.name)) {
					// Another partner's run is in flight (or the switch to this partner is still pending):
					// queue the message — it starts a fresh run for this partner once the run settles,
					// never a follow-up into the wrong partner's run (message isolation).
					pendingChats.push({ text, partner: target.name });
					return { accepted: true, queued: true };
				}
				// A fresh run (not a follow-up) belongs to the partner that sends it; capture it so the
				// view only shows writing/stop for that partner after a switch.
				if (!agent.isStreaming) runningPartner = target.name;
				// Await persistence; the view's subsequent history fetch will then include this message
				await agent.chat(text);
				return { accepted: true };
			},
			stop: () => {
				agent.stop();
				return { accepted: true };
			},
			reset: () => {
				agent.reset();
				return { accepted: true };
			},
			// The view actively pulls history after mounting (avoids the startup race: pushes may be lost before the view is ready)
			history: async () => {
				const target = await effectivePartner();
				if (!target) return { items: [] };
				await session.ready();
				const items = await session.visibleHistory(target.dir);
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
				return { items };
			},
			// The bun-side ground truth: true while streaming or executing tools; the view calibrates idle rendering with it
			get_status: () => ({
				// View-facing streaming: while an escalation awaits the human, present idle — the run is
				// paused on the approval gate, not generating. Internal isStreaming stays true: chat/queue
				// semantics and the running-partner capture must still see the busy run.
				streaming: agent.isStreaming && pendingSandboxConfirms.size === 0,
				workspace_path: agent.workspacePath ? tildify(agent.workspacePath) : null,
				running_partner: runningPartner,
				sandbox_mode: agent.sandboxMode,
			}),
			// set the per-partner mode from the composer select; persist + push so the view stays in sync
			set_sandbox_mode: async ({ mode }) => {
				if (!currentPartner) return { ok: false, error: "no partner selected" };
				if (!isSandboxMode(mode)) return { ok: false, error: "invalid mode" };
				agent.setSandboxMode(mode);
				await persistSandboxMode(mode);
				rpc.send.sandbox_mode_update({});
				return { ok: true };
			},
			// resolve a pending escalation (approve → run once with the requested mode; reject → nothing runs)
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
				let resume: { target: { name: string; dir: string }; request: EscalationRequestRecord; turn: ResumeTurn } | null = null;
				if (!pending && approved) {
					const target = await effectivePartner();
					// Idle only: restoring over a live run would yank the active context out from under it
					if (target && !agent.isStreaming) {
						const request = await session.escalationRequest(target.dir, id);
						const turn = request?.toolCallId ? await session.resumeTurn(target.dir, request.toolCallId) : null;
						if (request && turn) {
							resume = { target, request, turn };
						} else {
							approved = false; // unresumable — record the decision as rejected
						}
					} else {
						approved = false;
					}
				}
				// Persist the decision BEFORE resolving: the grant must not outrun the log, and a failed
				// persist must not run the command — the pending run is rejected, never hung.
				try {
					await session.appendEscalationRecord("escalation/decision", { escalationId: id, approved }, Date.now());
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
				if (resume) void resumeApprovedEscalation(resume.target, resume.request, resume.turn);
				return { ok: true };
			},
			// The model-visible surface (nodes + replace generation); observability for the surface layer
			surface: async () => {
				const target = await effectivePartner();
				if (!target) return { nodes: [], replaceGeneration: 0 };
				await session.ready();
				return session.surface(target.dir);
			},
			// Manual compaction: rewrite the model-visible surface (the log stays append-only)
			compact: async () => {
				const target = await effectivePartner();
				if (!target) return { ok: false, error: "no partner selected" };
				if (agent.isStreaming) return { ok: false, error: "agent is running" };
				await session.ready();
				const entries = await session.rawEntries(target.dir);
				const surface = await session.surface(target.dir);
				const plan = planCompaction(entries, surface);
				if (!plan) return { ok: true, compacted: 0 };
				await runCompaction(target, plan);
				return { ok: true, compacted: plan.range.end - plan.range.start + 1 };
			},
			// Context occupancy for the composer meter: used = last turn's provider-reported prompt size
			// (input + cacheRead + cacheWrite, no output), window = the routed model's contextWindow.
			// breakdown is the surface-priced composition (4 chars ≈ 1 token), always labeled `~` in the UI.
			context_usage: async () => {
				const target = await effectivePartner();
				const entries = target ? await session.rawEntries(target.dir) : [];
				const surface = target ? await session.surface(target.dir) : { nodes: [], replaceGeneration: 0 };
				const usage = lastUsage(entries);
				const used = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
				const window = contextWindow();
				const percent = used === 0 ? 0 : Math.min(100, Math.round((used / window) * 100));
				return {
					used,
					window,
					percent,
					breakdown: currentPartner ? priceSurface(agent.systemPrompt, TOOL_GUIDANCE, entries, surface) : null,
					lastTurn: usage ?? undefined,
				};
			},
			trajectory: async () => {
				const target = await effectivePartner();
				return { records: target ? fold(await session.rawEntries(target.dir)) : [] };
			},
			// Session-wide metrics: persisted usage totals (per partner dir) + in-memory run timing
			stats: async () => {
				const target = await effectivePartner();
				const usage = target ? aggregateUsage(await session.rawEntries(target.dir)) : null;
				return { usage, runtime: agent.runtimeStats };
			},
			get_settings: async () => {
				return {
					settings: await loadSettings(),
					runtime: {
						model: process.env["PI_MODEL"] ?? "deepseek-v4-flash",
						apiKeyConfigured: Boolean(process.env["DEEPSEEK_API_KEY"]),
					},
				};
			},
			update_settings: async ({ settings }) => {
				await saveSettings(settings);
				return { ok: true };
			},
			list_partners: async () => {
				const settings = await loadSettings();
				const profiles = await listPartners(settings);
				// Each row shows the partner's last visible message; read it per partner dir so the
				// list preview stays current even for chats that are not selected (isolation by dir).
				const partners = await Promise.all(
					profiles.map(async (profile) => {
						const last = await session.lastMessage(partnerDir(settings, profile.name));
						const lastMessageKind: "user" | "send_message" = last?.kind === "user" ? "user" : "send_message";
						return last ? { ...profile, lastMessage: last.text, lastMessageAt: last.time, lastMessageKind } : profile;
					}),
				);
				return { partners };
			},
			create_partner: async (input) => {
				try {
					const settings = await loadSettings();
					await createPartner(settings, input);
					return { ok: true };
				} catch (error) {
					if (error instanceof PartnerError) return { ok: false, error: error.message };
					console.error("create_partner failed:", error);
					return { ok: false, error: "Failed to create partner" };
				}
			},
			// Trial four-section system prompt preview (identify/tool-guidance are system-generated, shown read-only in the preview)
			preview_system_prompt: ({ profile }) => {
				return { prompt: agent.previewSystemPrompt(profile) };
			},
			set_partner: async ({ profile }) => {
				if (agent.isStreaming || pendingSwitch) {
					// A run is in flight (or a switch already is): defer the switch — applying it mid-run
					// would yank the session root and agent context out from under the running partner
					// (message isolation). Applied on agent_end, before queued messages drain.
					pendingSwitch = profile;
					return { ok: true };
				}
				await applyPartnerSwitch(profile);
				void drainQueued();
				return { ok: true };
			},
			delete_partner: async ({ name }) => {
				try {
					const settings = await loadSettings();
					await deletePartner(settings, name);
					// Drop the cached session root so a recreated same-name partner starts empty
					// (the store would otherwise keep the old in-memory session and replay its history)
					session.evictRoot(partnerDir(settings, name));
					return { ok: true };
				} catch (error) {
					if (error instanceof PartnerError) return { ok: false, error: error.message };
					console.error("delete_partner failed:", error);
					return { ok: false, error: "Failed to delete partner" };
				}
			},
		},
		messages: {},
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
