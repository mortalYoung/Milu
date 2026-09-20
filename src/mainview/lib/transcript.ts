import type { StoreApi } from "zustand/vanilla";
import { createStore } from "zustand/vanilla";
import { projectView } from "../../shared/entry-meta";
import type { ViewItem } from "../../shared/rpc";
import { type Entry, makeAgentEntry, makeCommandEntry, makeEscalationEntry, makeSepEntry, makeShellEntry, makeSkillEntry, makeSysEntry, makeUserEntry } from "./entries";
import type { SessionData } from "./session";

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const dayOf = (ts: number) => {
	const d = new Date(ts);
	return `${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

export function buildView(items: ViewItem[]): Entry[] {
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
			const entry = item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time, item.files);
			pushItem(entry, item.id);
		}
	}
	return out;
}

export type ChatBlock = Entry | Entry[];

export function blockKey(block: ChatBlock): string {
	const entry = Array.isArray(block) ? block[0] : block;
	return entry.key ?? String(entry.id);
}

export function groupView(view: Entry[]): ChatBlock[] {
	const out: ChatBlock[] = [];
	let stack: Entry[] | null = null;
	const flush = () => {
		if (stack) {
			out.push(stack);
			stack = null;
		}
	};
	for (const entry of view) {
		if (entry.kind === "agent" || entry.kind === "escalation") {
			(stack ??= []).push(entry);
		} else {
			flush();
			out.push(entry);
		}
	}
	flush();
	return out;
}

export interface TranscriptState {
	items: Entry[];
	blocks: ChatBlock[];
}

export interface TranscriptController {
	store: StoreApi<TranscriptState>;
	recompute: () => void;
}

export function createTranscript(session: StoreApi<SessionData>) {
	const store = createStore<TranscriptState>()(() => ({ items: [], blocks: [] }));

	function recompute() {
		const { origin } = session.getState();
		const items = buildView(projectView(origin.entries, { baseDir: origin.baseDir }));
		store.setState({ items, blocks: groupView(items) });
	}

	session.subscribe((state, previous) => {
		if (state.origin.entries === previous.origin.entries && state.origin.baseDir === previous.origin.baseDir) return;
		recompute();
	});

	return { store, recompute };
}
