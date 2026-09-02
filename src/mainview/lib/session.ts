import { createMemo } from "solid-js";
import { createStore } from "solid-js/store";
import { projectVisibleHistory } from "../../shared/entry-meta";
import type { ViewItem } from "../../shared/rpc";
import type { PartnerItem } from "../components/ConversationList";
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
import { createInFlightBoolean } from "./inflight";
import type { createOriginSession } from "./origin-session";
import type { RPC } from "./rpc";

type OriginSession = ReturnType<typeof createOriginSession>;

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const dayOf = (ts: number) => {
	const d = new Date(ts);
	return `${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

function buildViewEntries(items: ViewItem[]): Entry[] {
	const out: Entry[] = [];
	let lastDay = "";
	const sep = (ts: number) => {
		const day = dayOf(ts);
		if (lastDay && day !== lastDay) out.push(makeSepEntry(day));
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

interface SessionState {
	selected: string | null;
	partners: PartnerItem[];
	origin: OriginSession | null;
	overlay: Entry[];
	tick: number;
}

export function createSession(rpc: RPC, opts: { onSessionLoaded: () => void }) {
	const [state, setState] = createStore<SessionState>({
		selected: null,
		partners: [],
		origin: null,
		overlay: [],
		tick: 0,
	});

	const historyLoading = createInFlightBoolean();

	const selected = () => state.selected;
	const partners = () => state.partners;

	const entries = createMemo<Entry[]>(() => {
		const o = state.origin;
		const base = o ? buildViewEntries(projectVisibleHistory(o.entries())) : [];
		const extra = state.overlay;
		return extra.length > 0 ? [...base, ...extra] : base;
	});

	const attachOrigin = (o: OriginSession) => setState("origin", o);

	const bump = () => setState("tick", (t) => t + 1);
	const push = (entry: Entry) => {
		setState("overlay", (prev) => [...prev, entry]);
		bump();
	};

	async function refreshHistory() {
		historyLoading.begin();
		try {
			const o = state.origin;
			if (!o) return;
			await o.refresh();
			if (o.entries().length === 0) setState("overlay", []);
		} finally {
			historyLoading.end();
		}
	}

	async function loadOlderHistory(): Promise<boolean> {
		const o = state.origin;
		if (!o || !o.hasMore()) return false;
		const name = selected();
		historyLoading.begin();
		try {
			const before = o.entries().length;
			await o.loadMore();
			if (selected() !== name) return false;
			return o.entries().length !== before;
		} finally {
			historyLoading.end();
		}
	}

	async function refreshPartners() {
		const { partners: list } = await rpc.request.list_partners({});
		setState("partners", list);

		if (selected() != null && !list.some((p) => p.name === selected())) select(null);
	}

	function select(partner: PartnerItem | null) {
		setState("selected", partner?.name ?? null);
		setState("overlay", []);

		historyLoading.begin();
		void rpc.request
			.set_partner({
				profile: partner ? { name: partner.name, responsibilities: partner.responsibilities, tones: partner.tones } : null,
			})
			.then(() => {
				const o = state.origin;
				if (!o) {
					historyLoading.end();
					opts.onSessionLoaded();
					return;
				}
				void o
					.refresh()
					.catch(() => {})
					.finally(() => {
						historyLoading.end();
						opts.onSessionLoaded();
					});
			})
			.catch(() => {
				historyLoading.end();
			});
	}

	return {
		selected,
		partners,
		entries,
		tick: () => state.tick,
		push,
		bump,
		attachOrigin,
		refreshHistory,
		loadOlderHistory,
		refreshPartners,
		select,
		historyLoading: historyLoading.loading,
	};
}
