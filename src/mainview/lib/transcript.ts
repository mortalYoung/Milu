import { type Accessor, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { projectVisibleHistory } from "../../shared/entry-meta";
import type { ViewItem } from "../../shared/rpc";
import {
	type Entry,
	makeAgentEntry,
	makeCommandEntry,
	makeEscalationEntry,
	makeSepEntry,
	makeShellEntry,
	makeSkillEntry,
	makeSysEntry,
	makeUserEntry,
} from "../layouts/Transcript";
import { classifyReader, compensatedTop, distanceToBottom, floorTop, flowTop, isAtBottom, type ScrollAnchor } from "./scroll-anchor";
import { useSession } from "./session-context";

export interface TranscriptController {
	view: Accessor<Entry[]>;
	blocks: Accessor<(Entry | Entry[])[]>;
	showBackToBottom: Accessor<boolean>;
	scrollToBottom: (force?: boolean) => void;
	locate: (id: number) => void;
	persistAnchor: () => void;
	reset: () => void;
	setContainer: (el: HTMLElement) => void;
	detach: () => void;
}

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const dayOf = (ts: number) => {
	const d = new Date(ts);
	return `${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

function buildView(items: ViewItem[]): Entry[] {
	const out: Entry[] = [];
	let lastDay = "";
	const sep = (ts: number) => {
		const day = dayOf(ts);
		if (lastDay && day !== lastDay) {
			const entry = makeSepEntry(day);
			entry.key = `sep:${day}`;
			out.push(entry);
		}
		lastDay = day;
	};
	const pushItem = (entry: Entry, id: string) => {
		entry.key = id;
		out.push(entry);
	};
	for (const item of items) {
		if (item.kind === "error") {
			const entry = makeSysEntry(`ERR § ${item.text}`, true);
			pushItem(entry, item.id);
			continue;
		}
		if (item.kind === "aborted") {
			const entry = makeSysEntry("stopped", false, true);
			pushItem(entry, item.id);
			continue;
		}
		if (item.kind === "user" && item.skillName) continue;
		sep(item.time);
		if (item.kind === "escalation" && item.escalation) {
			const entry = makeEscalationEntry({ text: item.text, time: item.time, escalation: item.escalation });
			pushItem(entry, item.id);
		} else if (item.kind === "command" && item.command) {
			const entry = makeCommandEntry({ text: item.text, time: item.time, command: item.command });
			pushItem(entry, item.id);
		} else if (item.kind === "skill" && item.skill) {
			const entry = makeSkillEntry({ text: item.text, time: item.time, skill: item.skill });
			pushItem(entry, item.id);
		} else if (item.kind === "shell" && item.command) {
			const entry = makeShellEntry({ text: item.text, time: item.time, command: item.command });
			pushItem(entry, item.id);
		} else {
			const entry = item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time);
			pushItem(entry, item.id);
		}
	}
	return out;
}

function sameCommand(a: Entry["command"], b: Entry["command"]): boolean {
	if (!a || !b) return a === b;
	return a.commandId === b.commandId && a.name === b.name && a.args === b.args && a.text === b.text && a.status === b.status;
}

function sameEscalation(a: Entry["escalation"], b: Entry["escalation"]): boolean {
	if (!a || !b) return a === b;
	return a.id === b.id && a.command === b.command && a.from === b.from && a.to === b.to && a.justification === b.justification && a.status === b.status;
}

function sameEntry(a: Entry, b: Entry): boolean {
	return (
		a === b ||
		(a.kind === b.kind &&
			a.text === b.text &&
			a.time === b.time &&
			a.error === b.error &&
			a.aborted === b.aborted &&
			a.key === b.key &&
			sameCommand(a.command, b.command) &&
			sameCommand(a.skill, b.skill) &&
			sameEscalation(a.escalation, b.escalation))
	);
}

/** Keep unchanged rows on the same Entry objects so <For> (reference-keyed) does not remount them. */
function reconcileViews(prev: Entry[], next: Entry[]): Entry[] {
	const prevByKey = new Map<string, Entry>();
	for (const e of prev) {
		const key = e.key ?? String(e.id);
		if (!prevByKey.has(key)) prevByKey.set(key, e);
	}
	return next.map((e) => {
		const key = e.key ?? String(e.id);
		const old = prevByKey.get(key);
		return old && sameEntry(old, e) ? old : e;
	});
}

type ChatBlock = Entry | Entry[];

function blockKey(block: ChatBlock): string {
	const e = Array.isArray(block) ? block[0] : block;
	return e.key ?? String(e.id);
}

function sameStackRef(a: Entry[], b: Entry[]): boolean {
	return a.length === b.length && a.every((e, i) => e === b[i]);
}

/** Group the view into blocks, keeping stackable agent/escalation runs together. */
function groupView(view: Entry[]): ChatBlock[] {
	const out: ChatBlock[] = [];
	let stack: Entry[] | null = null;
	const flush = () => {
		if (stack) {
			out.push(stack);
			stack = null;
		}
	};
	for (const e of view) {
		if (e.kind === "agent" || e.kind === "escalation") {
			(stack ??= []).push(e);
		} else {
			flush();
			out.push(e);
		}
	}
	flush();
	return out;
}

/** Keep unchanged blocks on the same references so <For> does not remount them. */
function reconcileBlocks(prev: ChatBlock[], fresh: ChatBlock[]): ChatBlock[] {
	const prevByKey = new Map<string, ChatBlock>();
	for (const b of prev) prevByKey.set(blockKey(b), b);
	return fresh.map((b) => {
		const key = blockKey(b);
		const old = prevByKey.get(key);
		if (old === b) return old;
		if (Array.isArray(b) && Array.isArray(old) && sameStackRef(old, b)) return old;
		return b;
	});
}

export function createTranscript(opts?: { onFlash?: (id: number) => void }): TranscriptController {
	const { data } = useSession();
	const onFlash = opts?.onFlash;
	const [showBackToBottom, setShowBackToBottom] = createSignal(false);
	const [container, setContainer] = createSignal<HTMLElement | null>(null);

	let observedTop = 0;
	let atBottom = true;
	let anchor: ScrollAnchor | null = null;
	let pinRaf: number | null = null;

	const view = createMemo<Entry[]>((prev) => {
		const next = buildView(projectVisibleHistory(data.origin.entries));
		return reconcileViews(prev, next);
	}, []);

	const blocks = createMemo<ChatBlock[]>((prev) => reconcileBlocks(prev, groupView(view())), []);

	const writeScrollTop = (el: HTMLElement, top: number) => {
		el.scrollTop = top;
		observedTop = el.scrollTop;
	};

	const pinToBottom = (force = false) => {
		if (pinRaf != null) cancelAnimationFrame(pinRaf);
		pinRaf = requestAnimationFrame(() => {
			pinRaf = null;
			const el = container();
			if (!el) return;
			if (!force && !atBottom) return;
			writeScrollTop(el, el.scrollHeight);
			atBottom = true;
			anchor = null;
			setShowBackToBottom(false);
		});
	};

	const pickAnchorRow = (el: HTMLElement): HTMLElement | null => {
		const rect = el.getBoundingClientRect();
		if (typeof document.elementsFromPoint === "function") {
			const x = rect.left + rect.width / 2;
			const y = rect.top + 1;
			for (const node of document.elementsFromPoint(x, y)) {
				const row = (node as HTMLElement).closest?.("[data-chat-anchor-key]");
				if (row && el.contains(row)) return row as HTMLElement;
			}
		}
		for (const row of Array.from(el.querySelectorAll<HTMLElement>("[data-chat-flow-key]"))) {
			if (row.getBoundingClientRect().bottom > rect.top) return row;
		}
		return null;
	};

	const compensateAnchor = () => {
		if (!anchor) return;
		const el = container();
		if (!el) return;
		const row = el.querySelector<HTMLElement>(`[data-chat-anchor-key="${CSS.escape(anchor.key)}"]`);
		if (!row) return;
		writeScrollTop(el, compensatedTop(anchor, row.getBoundingClientRect().top, el.getBoundingClientRect().top));
	};

	const persistAnchor = () => requestAnimationFrame(compensateAnchor);

	const detach = () => {
		setContainer(null);
	};

	createEffect(() => {
		const el = container();
		if (!el) return;
		const body = el.firstElementChild as HTMLElement | null;
		if (!body) return;

		const onScroll = () => {
			const floor = floorTop(el.scrollHeight, el.clientHeight);
			const movedByReader = classifyReader(el.scrollTop, observedTop, floor);
			if (!movedByReader) return;
			const dist = distanceToBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
			atBottom = isAtBottom(dist);
			if (atBottom) {
				anchor = null;
				setShowBackToBottom(false);
			} else {
				const row = pickAnchorRow(el);
				if (row?.dataset["chatAnchorKey"]) {
					anchor = {
						key: row.dataset["chatAnchorKey"],
						anchorTop: flowTop(row.getBoundingClientRect().top, el.getBoundingClientRect().top),
						scrollTop: el.scrollTop,
					};
				}
				setShowBackToBottom(true);
			}
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		const ro = new ResizeObserver(() => {
			if (atBottom) pinToBottom(false);
		});
		ro.observe(body);
		onCleanup(() => {
			el.removeEventListener("scroll", onScroll);
			ro.disconnect();
		});
	});

	createEffect(() => {
		const all = blocks();
		if (all.length === 0) return;
		if (atBottom) pinToBottom(false);
	});

	return {
		view,
		blocks,
		showBackToBottom,
		scrollToBottom: pinToBottom,
		reset: () => {
			setShowBackToBottom(false);
			anchor = null;
			atBottom = true;
		},
		locate: (id: number) => {
			const ele = document.getElementById("entry-" + id);
			if (!ele) return;
			ele.scrollIntoView({ behavior: "smooth", block: "center" });
			onFlash?.(id);
		},
		persistAnchor,
		setContainer: setContainer,
		detach,
	};
}
