import { type Accessor, createEffect, createMemo } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { projectView } from "../../shared/entry-meta";
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
import { useSession } from "./contexts/session-context";

export interface TranscriptController {
	view: Accessor<Entry[]>;
	blocks: Accessor<(Entry | Entry[])[]>;
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
			const entry = item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time, item.files);
			pushItem(entry, item.id);
		}
	}
	return out;
}

type ChatBlock = Entry | Entry[];

function blockKey(block: ChatBlock): string {
	const e = Array.isArray(block) ? block[0] : block;
	return e.key ?? String(e.id);
}

function sameStackRef(a: Entry[], b: Entry[]): boolean {
	return a.length === b.length && a.every((e, i) => e === b[i]);
}

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

export function createTranscript(): TranscriptController {
	const { data } = useSession();

	const [items, setItems] = createStore<Entry[]>([]);
	createEffect(() => {
		const next = buildView(projectView(data.origin.entries, { baseDir: data.origin.baseDir }));
		setItems(reconcile(next, { key: "key" }));
	});

	const blocks = createMemo<ChatBlock[]>((prev) => reconcileBlocks(prev, groupView(items)), []);

	return { view: () => items, blocks };
}
