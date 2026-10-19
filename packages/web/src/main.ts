import { createFrontEnd } from "@milu/bootstrap/frontend";
import { dialogs } from "@milu/extensions/web";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { copyPath } from "./clipboard.ts";
import { SessionListSurface } from "./surfaces/session-list.tsx";
import { TranscriptPaneSurface } from "./surfaces/transcript-pane.tsx";
import { Workbench } from "./workbench.tsx";

import "./style.css";

async function main(): Promise<void> {
	const front = await createFrontEnd({
		url: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
		commands: { copy: (text) => copyPath(text) },
		dialogs,
		components: [
			{ id: "milu.session-list", component: SessionListSurface },
			{ id: "milu.transcript", component: TranscriptPaneSurface },
		],
	});

	const root = document.getElementById("root");
	if (!root) throw new Error("#root is missing from index.html");

	createRoot(root).render(createElement(Workbench, { host: front.host }));
	front.start();
}

void main();
