import { createFrontEnd } from "@milu/bootstrap/frontend";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { Shell } from "./shell.tsx";
import { ChatListSurface } from "./surfaces/chat-list.tsx";
import { ChatPaneSurface } from "./surfaces/chat-pane.tsx";

import "./style.css";

/** The browser's only job: build the view layer, hand it the surfaces, render the shell. */
async function main(): Promise<void> {
	const front = await createFrontEnd({
		url: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
		surfaces: [
			{ id: "milu.chat-list", slot: "sidebar", order: 10, component: ChatListSurface },
			{ id: "milu.chat-pane", slot: "main", order: 10, component: ChatPaneSurface },
		],
	});

	const root = document.getElementById("root");
	if (!root) throw new Error("#root is missing from index.html");

	createRoot(root).render(createElement(Shell, { host: front.host }));
	front.start();
}

void main();
