import type { Entry as OriginEntry } from "@earendil-works/pi-agent-core";
import { createEffect, createMemo } from "solid-js";
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
import type { RPC } from "./rpc";

const PAGE_SIZE = 500;

interface OriginData {
	entries: OriginEntry[];
	hasMore: boolean;
	total: number;
	loading: boolean;
}

interface SessionData {
	selected: string | null;
	partners: PartnerItem[];
	origin: OriginData;
}

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

export function createSession(rpc: RPC) {
	const [data, setData] = createStore<SessionData>({
		selected: null,
		partners: [],
		origin: {
			entries: [],
			hasMore: false,
			total: 0,
			loading: false,
		},
	});

	const historyLoading = createInFlightBoolean();

	let refreshPromise: { name: string | null; promise: Promise<void> } | null = null;

	function resetOrigin() {
		setData("origin", {
			entries: [],
			hasMore: false,
			total: 0,
			loading: false,
		});
	}

	function refresh(nameArg?: string | null): Promise<void> {
		const name = nameArg ?? data.selected;

		if (refreshPromise && refreshPromise.name === name) return refreshPromise.promise;
		const promise = performRefresh(name);
		refreshPromise = { name, promise };
		return promise;
	}

	async function performRefresh(name: string | null) {
		if (!name) {
			resetOrigin();
			refreshPromise = null;
			return;
		}
		setData("origin", "loading", true);
		try {
			if (data.selected !== name) return;
			const existing = data.origin.entries;
			const res =
				existing.length === 0
					? await rpc.request.session_origin({ name, limit: PAGE_SIZE })
					: await rpc.request.session_origin({ name, mode: "newer", cursor: existing.at(-1)!.id, limit: PAGE_SIZE });
			if (res.reset || existing.length === 0) {
				setData("origin", {
					entries: res.entries,
					hasMore: res.hasMore,
					total: res.total,
				});
				return;
			}
			const newIds = new Set(res.entries.map((e) => e.id));
			const older = existing.filter((e) => !newIds.has(e.id));
			setData("origin", {
				entries: [...older, ...res.entries],
				hasMore: data.origin.hasMore,
				total: res.total,
			});
		} catch (error) {
			console.error("session_origin refresh failed:", error);
			throw error;
		} finally {
			setData("origin", "loading", false);

			if (refreshPromise?.name === name) refreshPromise = null;
		}
	}

	async function loadMore() {
		const name = data.selected;
		if (!name || data.origin.loading || !data.origin.hasMore) return;
		const oldest = data.origin.entries[0]?.id;
		if (!oldest) return;
		setData("origin", "loading", true);
		try {
			const res = await rpc.request.session_origin({ name, mode: "older", cursor: oldest, limit: PAGE_SIZE });
			if (data.selected !== name) return;
			if (res.reset) {
				setData("origin", {
					entries: res.entries,
					hasMore: res.hasMore,
					total: res.total,
				});
				return;
			}
			const known = new Set(data.origin.entries.map((e) => e.id));
			const next = [...res.entries.filter((e) => !known.has(e.id)), ...data.origin.entries];
			setData("origin", {
				entries: next,
				hasMore: res.hasMore,
				total: res.total,
			});
		} finally {
			setData("origin", "loading", false);
		}
	}

	let lastSeenName: string | null = null;
	createEffect(() => {
		const name = data.selected;
		if (name === lastSeenName) return;
		lastSeenName = name;
		resetOrigin();
	});

	const entries = createMemo<Entry[]>(() => buildViewEntries(projectVisibleHistory(data.origin.entries)));

	async function refreshHistory() {
		historyLoading.begin();
		try {
			await refresh();
		} finally {
			historyLoading.end();
		}
	}

	async function loadOlderHistory(): Promise<boolean> {
		if (!data.origin.hasMore) return false;
		const name = data.selected;
		historyLoading.begin();
		try {
			const before = data.origin.entries.length;
			await loadMore();
			if (data.selected !== name) return false;
			return data.origin.entries.length !== before;
		} finally {
			historyLoading.end();
		}
	}

	async function refreshPartners() {
		const { partners: list } = await rpc.request.list_partners({});
		setData("partners", list);

		if (data.selected != null && !list.some((p) => p.name === data.selected)) select(null);
	}

	function select(partner: PartnerItem | null) {
		setData("selected", partner?.name ?? null);

		const profile = partner ? { name: partner.name, responsibilities: partner.responsibilities, tones: partner.tones } : null;
		historyLoading.begin();
		void Promise.all([
			// TODO: remove set_partner once every RPC is parameterized by partner name
			rpc.request.set_partner({ profile }),
			partner ? refresh(partner.name) : Promise.resolve(),
		])
			.catch(() => {})
			.finally(() => {
				historyLoading.end();
			});
	}

	const mutate = {
		refreshHistory,
		loadOlderHistory,
		refreshPartners,
		select,
		originRefresh: refresh,
		originLoadMore: loadMore,
	};

	return { data, entries, historyLoading: historyLoading.loading, mutate };
}
