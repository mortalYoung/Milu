import { createSignal } from "solid-js";
import type { PartnerItem } from "../components/ConversationList";
import { type Entry, makeAgentEntry, makeEscalationEntry, makeSepEntry, makeSysEntry, makeUserEntry } from "../layouts/Transcript";
import type { RPC } from "./rpc";

/**
 * The current conversation: partner list + selection + transcript entries.
 * `onSessionLoaded` fires after a selection's persisted history is re-read
 * (used to refresh the context meter, which is persisted per session).
 */
export function createSession(rpc: RPC, opts: { onSessionLoaded: () => void }) {
	const [selected, setSelected] = createSignal<string | null>(null);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [entries, setEntries] = createSignal<Entry[]>([]);
	const [tick, setTick] = createSignal(0);
	// True while persisted history is being (re)read — the transcript shows a "reading the
	// archives…" placeholder instead of the misleading "waiting for your first prompt" empty state.
	// A counter, not a bare boolean: refreshes (select, agent_message, escalation, mount) can overlap.
	const [historyLoading, setHistoryLoading] = createSignal(false);
	let historyInflight = 0;

	// Render source = the persisted JSONL; dedupe by id, only append new records.
	// Escalation entries are synced in place instead: a request's status flips pending → approved/rejected
	// after the decision is persisted, and appending a duplicate bubble would double-render the request.
	const renderedIds = new Set<string>();

	// Last calendar day seen: a day-divider entry is inserted only when the day actually changes
	let lastMsgDay = "";
	const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
	const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

	const bump = () => setTick((t) => t + 1);
	const push = (entry: Entry) => {
		setEntries((prev) => [...prev, entry]);
		bump();
	};

	function maybeTimeSeparator(d: Date) {
		const day = `${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
		if (lastMsgDay && day !== lastMsgDay) push(makeSepEntry(day));
		lastMsgDay = day;
	}

	async function refreshHistory() {
		historyInflight++;
		setHistoryLoading(true);
		try {
			const { items } = await rpc.request.history({});
			for (const item of items) {
				if (item.kind === "error") {
					push(makeSysEntry(`ERR § ${item.text}`, true));
					continue;
				}
				if (item.kind === "escalation" && item.escalation) {
					const entry = makeEscalationEntry({ text: item.text, time: item.time, escalation: item.escalation });
					const existing = entries().find((e) => e.kind === "escalation" && e.escalation?.id === item.escalation!.id);
					if (existing) {
						setEntries((prev) => prev.map((e) => (e.kind === "escalation" && e.escalation?.id === item.escalation!.id ? entry : e)));
					} else {
						maybeTimeSeparator(new Date(item.time));
						push(entry);
					}
					continue;
				}
				if (renderedIds.has(item.id)) continue;
				renderedIds.add(item.id);
				maybeTimeSeparator(new Date(item.time));
				push(item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time));
			}
		} finally {
			historyInflight--;
			if (historyInflight === 0) setHistoryLoading(false);
		}
	}

	async function refreshPartners() {
		const { partners: list } = await rpc.request.list_partners({});
		setPartners(list);
		// Clear when the selected one disappears
		if (selected() != null && !list.some((p) => p.name === selected())) select(null);
	}

	function select(partner: PartnerItem | null) {
		setSelected(partner?.name ?? null);
		setEntries([]);
		// History is cleared before the async re-read: hold the loading state across the
		// set_partner round-trip so the "reading the archives…" placeholder covers the whole gap.
		historyInflight++;
		setHistoryLoading(true);
		renderedIds.clear();
		lastMsgDay = "";
		void rpc.request
			.set_partner({
				profile: partner ? { name: partner.name, responsibilities: partner.responsibilities, tones: partner.tones } : null,
			})
			.then(() => {
				historyInflight--;
				refreshHistory();
				// The session is loaded now (entries restored from JSONL): refresh the context meter too,
				// so persisted usage survives restart instead of sitting at 0% until the next turn.
				opts.onSessionLoaded();
			})
			.catch(() => {
				historyInflight--;
				if (historyInflight === 0) setHistoryLoading(false);
			});
	}

	return { selected, partners, entries, tick, push, bump, refreshHistory, refreshPartners, select, historyLoading };
}
