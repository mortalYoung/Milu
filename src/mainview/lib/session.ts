import { createSignal } from "solid-js";
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
import type { RPC } from "./rpc";

export function createSession(rpc: RPC, opts: { onSessionLoaded: () => void; onEntriesChanged?: () => void }) {
	const [selected, setSelected] = createSignal<string | null>(null);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [entries, setEntries] = createSignal<Entry[]>([]);
	const [tick, setTick] = createSignal(0);

	const historyLoading = createInFlightBoolean();

	const renderedIds = new Set<string>();

	let lastMsgDay = "";
	const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
	const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

	const bump = () => setTick((t) => t + 1);
	const push = (entry: Entry) => {
		setEntries((prev) => [...prev, entry]);
		bump();
		opts.onEntriesChanged?.();
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

			const pending: Entry[] = [];
			const replacements = new Map<string, Entry>();
			for (const item of items) {
				if (item.kind === "error") {
					if (renderedIds.has(item.id)) continue;
					renderedIds.add(item.id);
					const entry = makeSysEntry(`ERR § ${item.text}`, true);
					entry.key = item.id;
					pending.push(entry);
					continue;
				}
				if (item.kind === "aborted") {
					if (renderedIds.has(item.id)) continue;
					renderedIds.add(item.id);
					const entry = makeSysEntry("stopped");
					entry.key = item.id;
					pending.push(entry);
					continue;
				}
				if (item.kind === "escalation" && item.escalation) {
					const entry = makeEscalationEntry({ text: item.text, time: item.time, escalation: item.escalation });
					entry.key = item.id;
					const existing = entries().find((e) => e.kind === "escalation" && e.escalation?.id === item.escalation!.id);
					if (existing) {
						replacements.set(item.escalation.id, entry);
					} else {
						maybeTimeSeparator(new Date(item.time), pending);
						pending.push(entry);
					}
					continue;
				}
				if (item.kind === "command" && item.command) {
					const entry = makeCommandEntry({ text: item.text, time: item.time, command: item.command });
					entry.key = item.id;
					const existing = entries().find((e) => e.kind === "command" && e.command?.commandId === item.command!.commandId);
					if (existing) {
						replacements.set(item.command.commandId, entry);
					} else {
						maybeTimeSeparator(new Date(item.time), pending);
						pending.push(entry);
					}
					continue;
				}
				if (item.kind === "skill" && item.skill) {
					const entry = makeSkillEntry({ text: item.text, time: item.time, skill: item.skill });
					entry.key = item.id;
					const existing = entries().find((e) => e.kind === "skill" && e.skill?.commandId === item.skill!.commandId);
					if (existing) {
						replacements.set(item.skill.commandId, entry);
					} else {
						maybeTimeSeparator(new Date(item.time), pending);
						pending.push(entry);
					}
					continue;
				}
				if (item.kind === "shell" && item.command) {
					const entry = makeShellEntry({ text: item.text, time: item.time, command: item.command });
					entry.key = item.id;
					const existing = entries().find((e) => e.kind === "shell" && e.command?.commandId === item.command!.commandId);
					if (existing) {
						replacements.set(item.command.commandId, entry);
					} else {
						maybeTimeSeparator(new Date(item.time), pending);
						pending.push(entry);
					}
					continue;
				}
				if (item.kind === "user" && item.skillName) {
					if (renderedIds.has(item.id)) continue;
					renderedIds.add(item.id);
					continue;
				}
				if (renderedIds.has(item.id)) continue;
				renderedIds.add(item.id);
				maybeTimeSeparator(new Date(item.time), pending);
				const entry = item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time);
				entry.key = item.id;
				pending.push(entry);
			}
			const tBuild = performance.now();
			if (replacements.size > 0 || pending.length > 0) {
				setEntries((prev) => {
					let next = prev;
					if (replacements.size > 0) {
						next = next.map((e) => {
							if (e.kind === "escalation" && e.escalation && replacements.has(e.escalation.id)) return replacements.get(e.escalation.id)!;
							if (e.kind === "command" && e.command && replacements.has(e.command.commandId)) return replacements.get(e.command.commandId)!;
							if (e.kind === "skill" && e.skill && replacements.has(e.skill.commandId)) return replacements.get(e.skill.commandId)!;
							return e;
						});
					}
					return pending.length > 0 ? [...next, ...pending] : next;
				});
				bump();
				opts.onEntriesChanged?.();
			}
			const t2 = performance.now();

			rpc.send.history_timing({ partner: selected() ?? "?", rpcMs: t1 - t0, buildMs: tBuild - t1, renderMs: t2 - tBuild, items: items.length });
		} finally {
			historyLoading.end();
		}
	}

	async function refreshPartners() {
		const { partners: list } = await rpc.request.list_partners({});
		setPartners(list);

		if (selected() != null && !list.some((p) => p.name === selected())) select(null);
	}

	function select(partner: PartnerItem | null) {
		setSelected(partner?.name ?? null);
		setEntries([]);

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

				opts.onSessionLoaded();
			})
			.catch(() => {
				historyLoading.end();
			});
	}

	return { selected, partners, entries, tick, push, bump, refreshHistory, refreshPartners, select, historyLoading: historyLoading.loading };
}
