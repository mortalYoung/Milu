import { join } from "node:path";
import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { createAgent } from "./core/agent";
import { createSessionStore } from "./core/session";
import { createPartner, deletePartner, listPartners, loadSettings, PartnerError, partnerRoot, saveSettings } from "./partners";

// 会话持久化:按 Partner 目录隔离;未选 Partner 时不可聊天
const session = createSessionStore();
let currentPartner: { name: string; dir: string } | null = null;

const agent = createAgent(
	{
		onTurnStart: (turn) => rpc.send.agent_turn({ turn }),
		// send_message 已入库,这里只发信号让视图重新拉取
		onMessage: () => rpc.send.agent_message({}),
		onEnd: (error) => rpc.send.agent_end({ error }),
	},
	{ session },
);

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: async ({ text }) => {
				// 必须选中 Partner 才能聊天
				if (!currentPartner) return { accepted: false };
				// await 持久化完成,视图随后拉取历史即可看到这条消息
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
			// 视图挂载后主动拉取历史(避免启动竞态:推送可能在视图就绪前丢失)
			history: async () => {
				if (!currentPartner) return { items: [] };
				await session.ready();
				return { items: session.visibleHistory() };
			},
			// bun 侧真实状态:流式/工具执行中为 true;视图以此校准 idle 渲染
			get_status: () => ({ streaming: agent.isStreaming }),
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
			// 校验 name + role(必填)→ <root>/<name>/profile.json
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
			// 试拼四段系统提示词预览(identify/tool-guidance 由系统生成,只读展示在预览里)
			preview_system_prompt: ({ profile }) => {
				return { prompt: agent.previewSystemPrompt(profile) };
			},
			// 选择 Partner → 切换到其目录的会话 + 恢复上下文 + 重建提示词
			set_partner: async ({ profile }) => {
				if (profile) {
					const settings = await loadSettings();
					currentPartner = { name: profile.name, dir: join(partnerRoot(settings), profile.name) };
					await session.setRoot(currentPartner.dir);
					const restored = await session.restoreMessages();
					agent.setPartner(profile);
					agent.restore(restored);
				} else {
					currentPartner = null;
					agent.setPartner(null);
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
		label: "CODING DESKTOP",
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
		// 1200×800:信纸栏 ~538px(≈55ch 阅读舒适),transcript 多显示约 2 条消息;适配 1440×900+ 屏幕
		width: 1200,
		height: 800,
		x: 120,
		y: 60,
	},
});

// ANSI green — one line, not worth a chalk dependency
console.log("\x1b[32mcoding-desktop started — agent ready\x1b[0m");
