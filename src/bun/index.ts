import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { createAgent, validateWorkspace } from "./core/agent";
import { contextWindow } from "./core/agent-config";
import { estimateBreakdown } from "./core/context-estimate";
import { createSessionStore } from "./core/session";
import { aggregateUsage, fold, lastUsage } from "./core/trajectory";
import { createPartner, deletePartner, listPartners, loadSettings, PartnerError, partnerDir, partnerRoot, saveSettings } from "./partners";
import { TOOL_GUIDANCE } from "./tools";

// Session persistence: isolated per Partner directory; chatting is disabled while no Partner is selected
const session = createSessionStore();
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
// Last prompt persisted per session root: dedupes redundant set_partner calls. Keyed by root because the
// prompt is now static (identical across partners) — a single last-value guard would suppress the append
// for every partner selected after the first, leaving those sessions without a system_prompt entry.
const persistedPromptByRoot = new Map<string, string>();

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
			rpc.send.agent_end({ error });
			void drainQueued();
		},
	},
	{ session },
);

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
		const restored = await session.restoreMessages(currentPartner.dir);
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
		// Persist the rebuilt prompt so the trajectory view can show it — per root, and only when it
		// actually changed; repeated partner switches would otherwise pile up identical system entries
		if (persistedPromptByRoot.get(currentPartner.dir) !== agent.systemPrompt) {
			persistedPromptByRoot.set(currentPartner.dir, agent.systemPrompt);
			await session.appendSystemPrompt(agent.systemPrompt, Date.now());
		}
		agent.restore(restored);
	} else {
		currentPartner = null;
		agent.setPartner(null);
		agent.setStoragePath(null);
		agent.setWorkspace(null);
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

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: async ({ text }) => {
				// The message targets the view's selection — the pending switch (deferred mid-run)
				// is that selection, so a message sent from its chat belongs to the pending partner.
				const target = pendingSwitch ?? currentPartner;
				if (!target) return { accepted: false };
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
				return { items: await session.visibleHistory(target.dir) };
			},
			// The bun-side ground truth: true while streaming or executing tools; the view calibrates idle rendering with it
			get_status: () => ({ streaming: agent.isStreaming, workspace_path: agent.workspacePath, running_partner: runningPartner }),
			// Context occupancy for the composer meter: used = last turn's provider-reported prompt size
			// (input + cacheRead + cacheWrite, no output), window = the routed model's contextWindow.
			// breakdown is the heuristic composition (4 chars ≈ 1 token), always labeled `~` in the UI.
			context_usage: async () => {
				const target = await effectivePartner();
				const entries = target ? await session.rawEntries(target.dir) : [];
				const usage = lastUsage(entries);
				const used = usage ? usage.input + usage.cacheRead + usage.cacheWrite : 0;
				const window = contextWindow();
				const percent = used === 0 ? 0 : Math.min(100, Math.round((used / window) * 100));
				return {
					used,
					window,
					percent,
					breakdown: currentPartner ? estimateBreakdown(agent.systemPrompt, TOOL_GUIDANCE, entries) : null,
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
						return last ? { ...profile, lastMessage: last.text, lastMessageAt: last.time, lastMessageKind: last.kind } : profile;
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
