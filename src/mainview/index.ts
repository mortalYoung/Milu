import { Electroview } from "electrobun/view";
import type { AppRPCSchema } from "../shared/rpc";

// ————— RPC —————
const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

// ————— DOM —————
const transcript = document.getElementById("transcript")!;
const emptyState = document.getElementById("empty-state")!;
const composer = document.getElementById("composer") as HTMLFormElement;
const promptInput = document.getElementById("prompt-input") as HTMLInputElement;
const statusBar = document.getElementById("status")!;
const statusText = document.getElementById("status-text")!;
const statusExtra = document.getElementById("status-extra")!;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;

// ————— view state —————
let busy = false;
let assistant: HTMLElement | null = null;
let assistantContent: HTMLElement | null = null;
let queued = 0;

function setStatus(text: string, running: boolean, extra = "") {
	statusText.textContent = text;
	statusBar.classList.toggle("running", running);
	statusExtra.textContent = extra;
}

function scrollToBottom() {
	transcript.scrollTop = transcript.scrollHeight;
}

function addEntry(kind: "user" | "agent"): HTMLElement {
	emptyState.remove();
	const entry = document.createElement("div");
	entry.className = `entry entry-${kind}`;
	const label = document.createElement("div");
	label.className = "entry-label";
	const tag = document.createElement("span");
	tag.className = "label-tag";
	tag.textContent = kind === "user" ? "you" : "agent";
	label.append(tag);
	const content = document.createElement("div");
	content.className = "entry-content";
	entry.append(label, content);
	transcript.append(entry);
	scrollToBottom();
	return entry;
}

function openAssistantBlock(turn: number) {
	if (assistant) {
		// same run, new turn → the outer loop drained a follow-up
		const sep = document.createElement("div");
		sep.className = "followup-sep";
		sep.textContent = `✳ follow-up · turn ${turn}`;
		transcript.append(sep);
	} else {
		const entry = addEntry("agent");
		assistant = entry;
		assistantContent = entry.querySelector(".entry-content")!;
	}
	scrollToBottom();
}

function markTool(name: string, status: "start" | "end") {
	if (!assistant) return;
	const chip = document.createElement("span");
	chip.className = "tool-chip";
	chip.dataset["tool"] = name;
	if (status === "end") chip.classList.add("done");
	chip.textContent = `⇢ ${name}`;
	assistantContent!.append(chip);
	scrollToBottom();
}

function finalizeAssistant(error?: string) {
	assistantContent?.querySelectorAll(".cursor").forEach((c) => c.remove());
	if (error) {
		const line = document.createElement("div");
		line.className = "error-line";
		line.textContent = error;
		assistantContent?.append(line);
	}
	assistant = null;
	assistantContent = null;
	scrollToBottom();
}

function sendUserMessage() {
	const text = promptInput.value.trim();
	if (!text) return;
	promptInput.value = "";
	promptInput.focus();

	// optimistic render; (queued) shows the outer loop at work
	const entry = addEntry("user");
	entry.querySelector(".entry-content")!.textContent = text;
	if (busy) {
		queued += 1;
		entry.querySelector(".entry-label")!.append(
			" · (queued as follow-up)",
		);
	}
	void rpc.request.chat({ text });
}

// ————— wire up —————
rpc.addMessageListener("agent_turn", ({ turn }) => {
	if (!busy) {
		busy = true;
		stopBtn.disabled = false;
	}
	openAssistantBlock(turn);
	if (queued > 0) queued -= 1;
	setStatus(
		`AGENT: RUNNING · TURN ${turn}`,
		true,
		queued > 0 ? `· ${queued} queued` : "",
	);
});

rpc.addMessageListener("agent_delta", ({ text }) => {
	if (!assistant) openAssistantBlock(1);
	assistantContent!.append(text);
	scrollToBottom();
});

rpc.addMessageListener("agent_tool", ({ name, status }) => {
	markTool(name, status);
});

rpc.addMessageListener("agent_end", ({ error }) => {
	busy = false;
	queued = 0;
	stopBtn.disabled = true;
	finalizeAssistant(error);
	setStatus(error ? "AGENT: ERROR" : "AGENT: IDLE", false);
});

composer.addEventListener("submit", (e) => {
	e.preventDefault();
	sendUserMessage();
});

stopBtn.addEventListener("click", () => {
	void rpc.request.stop({});
});

resetBtn.addEventListener("click", () => {
	void rpc.request.reset({});
	busy = false;
	queued = 0;
	stopBtn.disabled = true;
	assistant = null;
	assistantContent = null;
	transcript.replaceChildren();
	transcript.append(emptyState);
	setStatus("AGENT: IDLE", false);
	promptInput.focus();
});

promptInput.focus();
