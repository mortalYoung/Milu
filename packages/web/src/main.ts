import { createFrontEnd } from "@milu/bootstrap/frontend";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { SessionListSurface } from "./surfaces/session-list.tsx";
import { TranscriptPaneSurface } from "./surfaces/transcript-pane.tsx";
import { Workbench } from "./workbench.tsx";

import "./style.css";

/** The browser's only job: build the view layer, hand it the surfaces, render the shell. */
async function main(): Promise<void> {
	const front = await createFrontEnd({
		url: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
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
