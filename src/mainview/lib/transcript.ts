import type { StoreApi } from "zustand/vanilla";
import { createStore } from "zustand/vanilla";
import { projectView } from "../../shared/entry-meta";
import type { ViewItem } from "../../shared/rpc";
import {
	type AgentEntryExtras,
	type Entry,
	makeAgentEntry,
	makeCommandEntry,
	makeEscalationEntry,
	makeReplyEntry,
	makeSepEntry,
	makeShellEntry,
	makeSkillEntry,
	makeSysEntry,
	makeUserEntry,
} from "./entries";
import type { PartnerItem, SessionData } from "./session";

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
		} else if (item.kind === "user" && item.from && item.peerKind === "reply") {
			const entry = makeReplyEntry({ text: item.text, time: item.time, from: item.from, ...(item.requestId ? { requestId: item.requestId } : {}) });
			pushItem(entry, item.id);
		} else {
			const entry =
				item.kind === "user"
					? makeUserEntry(item.text, item.time, item.from, item.schedule ? { ...item.schedule } : undefined)
					: makeAgentEntry(item.text, item.time, item.files, item.to, agentExtras(item));
			pushItem(entry, item.id);
		}
	}
	return out;
}

/** A message's own row, when it is a thought or a call rather than words. */
function agentExtras(item: ViewItem): AgentEntryExtras {
	const step = item.stepMs != null ? { stepMs: item.stepMs } : {};
	if (item.thinking) return { thinking: item.thinking, ...step };
	if (item.say) return { say: true, ...step };
	if (!item.tool) return step;
	const { name, summary, status, args, result, isError } = item.tool;
	return {
		tool: { name, summary, status, ...(args !== undefined ? { args } : {}), ...(result !== undefined ? { result } : {}), ...(isError ? { isError: true } : {}) },
		...step,
	};
}

export interface StepGroup {
	key: string;
	rows: Entry[];
}

export const stepKeyOf = (entry: Entry): string | null => (entry.tool || entry.thinking || entry.say ? (entry.key ?? String(entry.id)).replace(/-\d{1,2}$/, "") : null);

/** Rows belong to the reply they were working towards, not to the assistant message that happened to
 *  carry them: one answer can come after several messages, each with its own thought and calls, and
 *  the reader thinks of that whole stretch as one reply. Rows that never find a reply (an aborted run,
 *  a tool-only tail) fold among themselves, keyed by the entry that started them. */
export function foldSteps(items: Entry[]): ({ entry: Entry } | { step: StepGroup })[] {
	const out: ({ entry: Entry } | { step: StepGroup })[] = [];
	let rows: Entry[] = [];
	const idOf = (entry: Entry) => entry.key ?? String(entry.id);
	const flush = (key?: string) => {
		if (rows.length === 0) return;
		const group = rows;
		rows = [];
		out.push({ step: { key: key ?? idOf(group[0]!), rows: group } });
	};
	for (const entry of items) {
		if (entry.tool || entry.thinking || entry.say) {
			rows.push(entry);
			continue;
		}
		flush(entry.kind === "agent" ? idOf(entry) : undefined);
		out.push({ entry });
	}
	flush();
	return out;
}

/** What a folded step says about itself: how long it took, how much it did, what failed. A count of
 *  zero stays out, and a step under a second does not claim a duration at all. The time is the sum of
 *  the turns it took — the same step can span several assistant messages. */
export function stepSummary(rows: Entry[]): { text: string; fail?: boolean }[] {
	const tools = rows.filter((row) => row.tool).length;
	const failed = rows.filter((row) => row.tool?.status === "error").length;
	const perEntry = new Map<string, number>();
	for (const row of rows) {
		const key = stepKeyOf(row);
		if (key == null || row.stepMs == null || perEntry.has(key)) continue;
		perEntry.set(key, row.stepMs);
	}
	const ms = [...perEntry.values()].reduce((total, value) => total + value, 0);
	const parts: { text: string; fail?: boolean }[] = [];
	if (ms >= 1000) parts.push({ text: `${(ms / 1000).toFixed(1)}s` });
	if (tools > 0) parts.push({ text: `${tools} tool${tools === 1 ? "" : "s"}` });
	if (failed > 0) parts.push({ text: `${failed} failed`, fail: true });
	if (parts.length === 0) parts.push({ text: `${rows.length} thought${rows.length === 1 ? "" : "s"}` });
	return parts;
}

export function itemKey(entry: Entry): string {
	return entry.key ?? String(entry.id);
}

/** A prompt sitting at the head of the queue that the run log does not have yet — only the head gets
 *  one; anything behind it belongs to the follow-up dock. */
export interface Echo {
	messageId: string;
	text: string;
	at: number;
	abandoned?: boolean;
}

export interface TranscriptState {
	items: Entry[];
	pending: Record<string, Echo[]>;
}

export interface TranscriptController {
	store: StoreApi<TranscriptState>;
	recompute: () => void;
	echo: (partner: string, messageId: string, text: string) => void;
	drop: (partner: string, messageId: string) => void;
	abandon: (partner: string) => void;
}

const ECHO_TTL_MS = 120_000;
const ECHO_MAX = 4;

const isOwnPrompt = (entry: Entry): boolean => entry.kind === "user" && !entry.from && !entry.schedule && !entry.echo;

/** Only the tail of the list can be news, only your own prompts count, and the queue and the log keep
 *  the same order — so the oldest echo goes with the oldest match, the words being a second check. */
export function reconcileEchoes(pending: Record<string, Echo[]>, partner: string | null, previous: Entry[], items: Entry[]): Record<string, Echo[]> {
	if (!partner) return pending;
	const list = pending[partner];
	if (!list || list.length === 0) return pending;
	const last = previous.at(-1);
	const from = last ? items.findIndex((entry) => itemKey(entry) === itemKey(last)) : -1;
	const landed = (last && from >= 0 ? items.slice(from + 1) : items).filter(isOwnPrompt);
	const rest = [...list];
	for (const entry of landed) {
		const index = rest.findIndex((echo) => echo.text.trim() === entry.text.trim());
		if (index >= 0) rest.splice(index, 1);
	}
	for (let index = rest.length - 1; index >= 0; index -= 1) if (rest[index]!.abandoned) rest.splice(index, 1);
	if (rest.length === list.length) return pending;
	const next = { ...pending };
	if (rest.length === 0) delete next[partner];
	else next[partner] = rest;
	return next;
}

export function createTranscript(session: StoreApi<SessionData>) {
	const store = createStore<TranscriptState>()(() => ({ items: [], pending: {} }));

	function recompute() {
		const { origin, selected } = session.getState();
		const previous = store.getState().items;
		const items = buildView(projectView(origin.entries, { baseDir: origin.baseDir }));
		store.setState({ items, pending: reconcileEchoes(store.getState().pending, selected, previous, items) });
	}

	function patchPending(partner: string, next: (list: Echo[]) => Echo[] | null) {
		store.setState((state) => {
			const list = state.pending[partner];
			if (!list) return state;
			const updated = next(list);
			if (updated === null) return state;
			const pending = { ...state.pending };
			if (updated.length === 0) delete pending[partner];
			else pending[partner] = updated;
			return { ...state, pending };
		});
	}

	function drop(partner: string, messageId: string) {
		patchPending(partner, (list) => (list.some((echo) => echo.messageId === messageId) ? list.filter((echo) => echo.messageId !== messageId) : null));
	}

	function echo(partner: string, messageId: string, text: string) {
		store.setState((state) => {
			const list = state.pending[partner] ?? [];
			if (list.some((item) => item.messageId === messageId) || list.length >= ECHO_MAX) return state;
			return { ...state, pending: { ...state.pending, [partner]: [...list, { messageId, text, at: Date.now() }] } };
		});
		setTimeout(() => drop(partner, messageId), ECHO_TTL_MS);
	}

	/** From here on only the log can keep an echo alive. */
	function abandon(partner: string) {
		patchPending(partner, (list) => list.map((item) => ({ ...item, abandoned: true })));
	}

	function prune(partners: PartnerItem[]) {
		const keys = Object.keys(store.getState().pending);
		if (keys.length === 0) return;
		const alive = new Set(partners.map((partner) => partner.name));
		const gone = keys.filter((key) => !alive.has(key));
		if (gone.length === 0) return;
		store.setState((state) => {
			const pending = { ...state.pending };
			for (const key of gone) delete pending[key];
			return { ...state, pending };
		});
	}

	session.subscribe((state, previous) => {
		if (state.partners !== previous.partners) prune(state.partners);
		if (state.origin.entries === previous.origin.entries && state.origin.baseDir === previous.origin.baseDir) return;
		recompute();
	});

	return { store, recompute, echo, drop, abandon };
}
