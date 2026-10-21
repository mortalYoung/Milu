import { createFrontEnd } from "@milu/bootstrap/frontend";
import { createMarkdown, DEFAULT_PLUGINS } from "@milu/extensions/markdown";
import { dialogs, markdown as markdownPlugins, services as extensionServices, slots as extensionSlots, triggers as extensionTriggers, widgets } from "@milu/extensions/web";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { copyPath } from "./clipboard.ts";
import { installMarkdownClicks } from "./markdown-clicks.ts";
import { SessionListSurface } from "./surfaces/session-list.tsx";
import { TranscriptPaneSurface } from "./surfaces/transcript-pane.tsx";
import { IpcTransport } from "./transport.ts";
import { Workbench } from "./workbench.tsx";

import "./style.css";

async function main(): Promise<void> {
	const front = await createFrontEnd({
		transport: new IpcTransport(),
		markdown: createMarkdown([...DEFAULT_PLUGINS, ...markdownPlugins]),
		platform: "desktop",
		commands: { copy: (text) => copyPath(text) },
		dialogs,
		widgets,
		triggers: extensionTriggers,
		services: extensionServices,
		slots: extensionSlots,
		components: [
			{ id: "milu.session-list", component: SessionListSurface },
			{ id: "milu.transcript", component: TranscriptPaneSurface },
		],
	});

	const root = document.getElementById("root");
	if (!root) throw new Error("#root is missing from index.html");

	installMarkdownClicks(front.host);
	createRoot(root).render(createElement(Workbench, { host: front.host }));
	front.start();
}

void main();
