import { createFrontEnd } from "@milu/bootstrap/frontend";
import { createMarkdown, DEFAULT_PLUGINS } from "@milu/window/markdown";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { mark, reportBootTo } from "./boot.ts";
import { installWindowBridge } from "./bridge.ts";
import { copyPath } from "./clipboard.ts";
import { commandsTrigger } from "./composer/commands.tsx";
import { partnersTrigger } from "./composer/mentions.tsx";
import { installMarkdownClicks } from "./markdown-clicks.ts";
import { Root } from "./root.tsx";
import { SessionListSurface } from "./surfaces/session-list.tsx";
import { TranscriptPaneSurface } from "./surfaces/transcript-pane.tsx";
import { IpcTransport } from "./transport.ts";

import "./style.css";

async function main(): Promise<void> {
	const transport = new IpcTransport();
	reportBootTo((marks) => void transport.request("boot", { marks }));
	mark("script");

	installWindowBridge();

	const front = await createFrontEnd({
		transport,
		markdown: createMarkdown([...DEFAULT_PLUGINS]),
		platform: "desktop",
		mark,
		commands: { copy: (text) => copyPath(text) },
		triggers: [commandsTrigger, partnersTrigger],
		components: [
			{ id: "milu.session-list", component: SessionListSurface },
			{ id: "milu.transcript", component: TranscriptPaneSurface },
		],
	});

	mark("front");

	const root = document.getElementById("root");
	if (!root) throw new Error("#root is missing from index.html");

	installMarkdownClicks(front.host);
	front.host.connection.onSnapshot(() => mark("snapshot"));
	createRoot(root).render(createElement(Root, { host: front.host }));
	front.start();
}

void main();
