/**
 * Controller — the view's shell layer.
 * Owns app state (busy/queued) and the shell chrome, and wires
 * RPC events to the transcript renderer (`transcript.ts`).
 * No DOM rendering of the transcript lives here.
 */
import { Electroview } from "electrobun/view";
import { createIcons, ArrowUp, Square } from "lucide";
import type { AppRPCSchema } from "../shared/rpc";
import { createTranscript } from "./transcript";

// ————— RPC —————
const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

// ————— icons (lucide) —————
createIcons({ icons: { ArrowUp, Square } });

// ————— DOM refs —————
const transcript = createTranscript(
	document.getElementById("transcript")!,
	document.getElementById("empty-state")!,
);
const composer = document.getElementById("composer") as HTMLFormElement;
const promptInput = document.getElementById("prompt-input") as HTMLInputElement;
const statusBar = document.getElementById("status")!;
const statusText = document.getElementById("status-text")!;
const statusExtra = document.getElementById("status-extra")!;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;

// ————— app state —————
let busy = false;
let queued = 0;

function setStatus(text: string, running: boolean, extra = "") {
	statusText.textContent = text;
	statusBar.classList.toggle("running", running);
	statusExtra.textContent = extra;
}

// One button, two modes (ChatGPT-style): send (arrow-up) while idle,
// stop (square) while running — the icon swaps via the `.running` class.
function setSendMode() {
	sendBtn.classList.toggle("running", busy);
	sendBtn.setAttribute("aria-label", busy ? "stop" : "send");
}

// ————— RPC events → state + transcript —————
rpc.addMessageListener("agent_turn", ({ turn }) => {
	busy = true;
	transcript.openAgent(turn);
	if (queued > 0) queued -= 1;
	setSendMode();
	setStatus(`AGENT: RUNNING · TURN ${turn}`, true, queued > 0 ? `· ${queued} queued` : "");
});

rpc.addMessageListener("agent_delta", ({ text }) => {
	transcript.appendDelta(text);
});

rpc.addMessageListener("agent_tool", ({ name, status }) => {
	transcript.addTool(name, status);
});

rpc.addMessageListener("agent_end", ({ error }) => {
	busy = false;
	queued = 0;
	transcript.finish(error);
	setSendMode();
	setStatus(error ? "AGENT: ERROR" : "AGENT: IDLE", false);
});

// ————— user input —————
function sendUserMessage() {
	const text = promptInput.value.trim();
	if (!text) return;
	promptInput.value = "";
	promptInput.focus();

	// optimistic render; queued shows the outer loop at work
	transcript.addUser(text, busy);
	if (busy) queued += 1;
	void rpc.request.chat({ text });
}

// Enter always sends (queues as follow-up when busy); the button stops when running.
composer.addEventListener("submit", (e) => {
	e.preventDefault();
	sendUserMessage();
});

sendBtn.addEventListener("click", () => {
	if (busy) {
		void rpc.request.stop({});
	} else {
		sendUserMessage();
	}
});

promptInput.focus();
