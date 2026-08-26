import { createSignal } from "solid-js";
import type { PartnerItem } from "../components/ConversationList";
import { type Entry, makeAgentEntry, makeEscalationEntry, makeSepEntry, makeSysEntry, makeUserEntry } from "../layouts/Transcript";
import { createInFlightBoolean } from "./inflight";
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
	// Counter-backed (not a bare boolean): refreshes (select, agent_message, escalation, mount) can
	// overlap, and the flag stays true until the LAST in-flight refresh settles.
	const historyLoading = createInFlightBoolean();

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

	function maybeTimeSeparator(d: Date, buffer: Entry[]) {
		const day = `${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
		if (lastMsgDay && day !== lastMsgDay) buffer.push(makeSepEntry(day));
		lastMsgDay = day;
	}

	async function refreshHistory() {
		historyLoading.begin();
		const t0 = performance.now();
		try {
			const { items } = await rpc.request.history({});
			const t1 = performance.now();
			// Batch build: collect appends + in-place escalation replacements locally, then commit
			// ONCE (single setEntries + single bump). One push per item would re-render the whole
			// transcript each time (Solid doesn't auto-batch signal writes) — O(n²) markdown renders.
			const pending: Entry[] = [];
			const replacements = new Map<string, Entry>();
			for (const item of items) {
				if (item.kind === "error") {
					// Dedupe by entry id like normal messages — otherwise every history refresh
					// re-appends the same error bubble.
					if (renderedIds.has(item.id)) continue;
					renderedIds.add(item.id);
					pending.push(makeSysEntry(`ERR § ${item.text}`, true));
					continue;
				}
				if (item.kind === "aborted") {
					if (renderedIds.has(item.id)) continue;
					renderedIds.add(item.id);
					pending.push(makeSysEntry("stopped"));
					continue;
				}
				if (item.kind === "escalation" && item.escalation) {
					const entry = makeEscalationEntry({ text: item.text, time: item.time, escalation: item.escalation });
					const existing = entries().find((e) => e.kind === "escalation" && e.escalation?.id === item.escalation!.id);
					if (existing) {
						replacements.set(item.escalation.id, entry);
					} else {
						maybeTimeSeparator(new Date(item.time), pending);
						pending.push(entry);
					}
					continue;
				}
				if (renderedIds.has(item.id)) continue;
				renderedIds.add(item.id);
				maybeTimeSeparator(new Date(item.time), pending);
				pending.push(item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time));
			}
			const tBuild = performance.now();
			if (replacements.size > 0 || pending.length > 0) {
				setEntries((prev) => {
					let next = prev;
					if (replacements.size > 0) {
						next = next.map((e) => (e.kind === "escalation" && e.escalation && replacements.has(e.escalation.id) ? replacements.get(e.escalation.id)! : e));
					}
					return pending.length > 0 ? [...next, ...pending] : next;
				});
				bump();
			}
			const t2 = performance.now();
			// Timing probe (view-side): RPC round-trip vs batch-build vs the single commit render —
			// sent to bun (history_timing) so it appears in the terminal log next to the bun-side numbers.
			rpc.send.history_timing({ partner: selected() ?? "?", rpcMs: t1 - t0, buildMs: tBuild - t1, renderMs: t2 - tBuild, items: items.length });
		} finally {
			historyLoading.end();
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
		historyLoading.begin();
		renderedIds.clear();
		lastMsgDay = "";
		void rpc.request
			.set_partner({
				profile: partner ? { name: partner.name, responsibilities: partner.responsibilities, tones: partner.tones } : null,
			})
			.then(() => {
				historyLoading.end();
				refreshHistory();
				// The session is loaded now (entries restored from JSONL): refresh the context meter too,
				// so persisted usage survives restart instead of sitting at 0% until the next turn.
				opts.onSessionLoaded();
			})
			.catch(() => {
				historyLoading.end();
			});
	}

	return { selected, partners, entries, tick, push, bump, refreshHistory, refreshPartners, select, historyLoading: historyLoading.loading };
}
