/**
 * Transcript rendering — the document layer, IM-style.
 * Pure DOM: knows nothing about RPC, the agent, or app state.
 * The controller (`index.ts`) decides WHAT happened; this decides how it looks.
 *
 * Conventions: user bubbles right (ink), agent bubbles left (paper),
 * centered mono system lines for tools/follow-ups/errors, timestamps on
 * every message, dashed time separators on gaps.
 */

export interface Transcript {
	/** Wipe the transcript and restore the empty-state hint. */
	clear(): void;
	/** Render a user entry. `queued` marks it as a follow-up (outer loop). */
	addUser(text: string, queued: boolean): void;
	/** Open an agent entry, or insert a follow-up separator if one is open. */
	openAgent(turn: number): void;
	/** Append a streaming text delta to the open agent entry. */
	appendDelta(text: string): void;
	/** Add a tool chip to the open agent entry. */
	addTool(name: string, status: "start" | "end"): void;
	/** Close the agent entry; `error` renders an ERR line. */
	finish(error?: string): void;
}

const SEPARATOR_GAP_MS = 5 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function createTranscript(container: HTMLElement, emptyState: HTMLElement): Transcript {
	let assistantContent: HTMLElement | null = null;
	let lastMsgTime = 0;
	const toolEls = new Map<string, HTMLElement>();

	const scrollToBottom = () => {
		container.scrollTop = container.scrollHeight;
	};

	function addSystem(text: string, error = false): HTMLElement {
		const el = document.createElement("div");
		el.className = error ? "sys sys-error" : "sys";
		el.textContent = text;
		container.append(el);
		scrollToBottom();
		return el;
	}

	function addTimeSeparator(d: Date) {
		const sameDay = new Date(lastMsgTime).toDateString() === d.toDateString();
		const el = document.createElement("div");
		el.className = "time-sep";
		el.textContent = sameDay ? fmtTime(d) : `${d.getMonth() + 1}/${d.getDate()} · ${fmtTime(d)}`;
		container.append(el);
		scrollToBottom();
	}

	function addMessage(kind: "user" | "agent"): HTMLElement {
		const now = new Date();
		if (lastMsgTime && now.getTime() - lastMsgTime > SEPARATOR_GAP_MS) {
			addTimeSeparator(now);
		}
		lastMsgTime = now.getTime();
		emptyState.remove();
		const msg = document.createElement("div");
		msg.className = `msg msg-${kind}`;
		const bubble = document.createElement("div");
		bubble.className = "msg-bubble";
		const meta = document.createElement("div");
		meta.className = "msg-meta";
		meta.textContent = fmtTime(now);
		msg.append(bubble, meta);
		container.append(msg);
		scrollToBottom();
		return bubble;
	}

	function openAgentBlock(turn: number) {
		if (assistantContent) {
			// Same run, new turn → the outer loop drained a follow-up.
			addSystem(`✳ follow-up · turn ${turn}`);
			return;
		}
		const bubble = addMessage("agent");
		assistantContent = bubble;
		const cursor = document.createElement("span");
		cursor.className = "cursor";
		bubble.append(cursor);
	}

	return {
		clear() {
			assistantContent = null;
			lastMsgTime = 0;
			toolEls.clear();
			container.replaceChildren();
			container.append(emptyState);
		},
		addUser(text: string, queued: boolean) {
			if (queued) addSystem("✳ follow-up queued");
			const bubble = addMessage("user");
			bubble.textContent = text;
		},
		openAgent(turn: number) {
			openAgentBlock(turn);
		},
		appendDelta(text: string) {
			if (!assistantContent) openAgentBlock(1);
			assistantContent!.append(text);
			scrollToBottom();
		},
		addTool(name: string, status: "start" | "end") {
			if (status === "start") {
				toolEls.set(name, addSystem(`⇢ ${name} · running…`));
			} else {
				const el = toolEls.get(name);
				if (el) {
					el.textContent = `⇢ ${name} · ran ✓`;
					toolEls.delete(name);
				}
			}
		},
		finish(error?: string) {
			assistantContent?.querySelectorAll(".cursor").forEach((c) => c.remove());
			assistantContent = null;
			if (error) addSystem(`ERR § ${error}`, true);
			scrollToBottom();
		},
	};
}
