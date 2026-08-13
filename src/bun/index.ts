import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { createAgent } from "./core/agent";
import { createSessionStore } from "./core/session";

// 对话持久化(直接 JSONL,.database/message.jsonl)
const session = createSessionStore();

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
				await session.ready();
				return { items: session.visibleHistory() };
			},
		},
		messages: {},
	},
});

// 启动恢复:完整链 → agent 上下文(前端历史由视图挂载后主动拉取)
void session.ready().then(async () => {
	const restored = await session.restoreMessages();
	if (restored.length > 0) agent.restore(restored);
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
		width: 960,
		height: 700,
		x: 120,
		y: 60,
	},
});

// ANSI green — one line, not worth a chalk dependency
console.log("\x1b[32mcoding-desktop started — agent ready\x1b[0m");
