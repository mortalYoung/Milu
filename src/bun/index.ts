import { ApplicationMenu, BrowserWindow, BrowserView } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { createAgent } from "./agent";

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

const agent = createAgent({
	onDelta: (text) => rpc.send.agent_delta({ text }),
	onTurnStart: (turn) => rpc.send.agent_turn({ turn }),
	onTool: (name, status) => rpc.send.agent_tool({ name, status }),
	onEnd: (error) => rpc.send.agent_end({ error }),
});

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			chat: ({ text }) => {
				agent.chat(text);
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
		},
		messages: {},
	},
});

new BrowserWindow({
	title: "Coding",
	// IDE-style: no title text; traffic lights overlay the view,
	// whose top strip is a drag region (see index.html).
	titleBarStyle: "hiddenInset",
	url: "views://mainview/index.html",
	rpc,
	frame: {
		width: 540,
		height: 680,
		x: 120,
		y: 60,
	},
});

// ANSI green — one line, not worth a chalk dependency
console.log("\x1b[32mcoding-desktop started — agent ready\x1b[0m");
