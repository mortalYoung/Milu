import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { createAgent } from "./core/agent";
import { createSessionStore } from "./core/session";
import { fold } from "./core/trajectory";
import { createPartner, deletePartner, listPartners, loadSettings, PartnerError, partnerRoot, saveSettings } from "./partners";

// Session persistence: isolated per Partner directory; chatting is disabled while no Partner is selected
const session = createSessionStore();
let currentPartner: { name: string; dir: string } | null = null;
// Last prompt persisted per session root: dedupes redundant set_partner calls. Keyed by root because the
// prompt is now static (identical across partners) — a single last-value guard would suppress the append
// for every partner selected after the first, leaving those sessions without a system_prompt entry.
const persistedPromptByRoot = new Map<string, string>();

const agent = createAgent(
	{
		onTurnStart: (turn) => rpc.send.agent_turn({ turn }),
		// send_message is already in the store; here we only signal the view to refetch
		onMessage: () => rpc.send.agent_message({}),
		// A turn has been persisted; the view invalidates its trajectory cache and refetches
		onTrajectoryUpdate: () => rpc.send.trajectory_update({}),
		// The workspace was set; the view refetches status and shows it near the input
		onWorkspaceUpdate: () => rpc.send.workspace_update({}),
		onEnd: (error) => rpc.send.agent_end({ error }),
	},
	{ session },
);

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: async ({ text }) => {
				if (!currentPartner) return { accepted: false };
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
				if (!currentPartner) return { items: [] };
				await session.ready();
				return { items: session.visibleHistory() };
			},
			// The bun-side ground truth: true while streaming or executing tools; the view calibrates idle rendering with it
			get_status: () => ({ streaming: agent.isStreaming, workspace_path: agent.workspacePath }),
			trajectory: () => ({ records: currentPartner ? fold(session.rawEntries()) : [] }),
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
				return { partners: await listPartners(settings) };
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
				if (profile) {
					const settings = await loadSettings();
					currentPartner = { name: profile.name, dir: join(partnerRoot(settings), profile.name) };
					await session.setRoot(currentPartner.dir);
					const restored = await session.restoreMessages();
					agent.setPartner(profile);
					// Storage: partner-scoped directory the agent may freely write to; must exist before the prompt mentions it
					const storagePath = join(currentPartner.dir, "storage");
					await mkdir(storagePath, { recursive: true });
					agent.setStoragePath(storagePath);
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
				}
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
