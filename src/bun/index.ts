import { BrowserWindow, BrowserView } from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc";
import { createAgent } from "./agent";

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
	title: "coding desktop",
	url: "views://mainview/index.html",
	rpc,
	frame: {
		width: 860,
		height: 920,
		x: 120,
		y: 60,
	},
});

console.log("coding-desktop started — agent ready");
