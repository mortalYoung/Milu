/**
 * App — the controller. Owns app state, wires RPC events into visible
 * transcript entries, and renders the shell: icon rail + chat / settings views.
 * Partners are created via a modal and saved as folders (see src/bun/partners.ts).
 */

import { Electroview } from "electrobun/view";
import { createSignal } from "solid-js";
import type { AppRPCSchema, ContextUsage, SessionStats, TrajectoryRecord } from "../shared/rpc";
import { AppRail } from "./components/AppRail";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { type PartnerFormData, PartnerModal } from "./components/PartnerModal";
import { TrajectoryDrawer } from "./components/TrajectoryDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { type Entry, makeAgentEntry, makeSepEntry, makeSysEntry, makeUserEntry, SEPARATOR_GAP_MS } from "./layouts/Transcript";
import { ConversationPage } from "./pages/ConversationPage";
import { type SettingsData, SettingsView } from "./pages/SettingsView";

// ————— RPC —————
const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: { requests: {}, messages: {} },
});
new Electroview({ rpc });

interface PartnerItem {
	name: string;
	responsibilities?: string;
	tones?: string;
	createdAt: number;
	/** Last visible message (chat-list preview); undefined when the chat is empty. */
	lastMessage?: string;
	/** Timestamp of the last visible message. */
	lastMessageAt?: number;
	/** Who sent the last message — "user" (you) or "send_message" (the partner's reply). */
	lastMessageKind?: "user" | "send_message";
}

export function App() {
	// ————— state —————
	const [view, setView] = createSignal<"chat" | "settings">("chat");
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	// Partner details dialog (shared by the list menu / header click)
	const [detailsPartner, setDetailsPartner] = createSignal<PartnerItem | null>(null);
	// Trajectory drawer (density strip): whole-log view, opened from the header
	const [trajectoryOpen, setTrajectoryOpen] = createSignal(false);
	const [trajectoryRecords, setTrajectoryRecords] = createSignal<TrajectoryRecord[]>([]);
	const [workspacePath, setWorkspacePath] = createSignal<string | null>(null);
	const [contextUsage, setContextUsage] = createSignal<ContextUsage | null>(null);
	const [stats, setStats] = createSignal<SessionStats | null>(null);
	const [entries, setEntries] = createSignal<Entry[]>([]);
	// busy = whether the agent is running (streaming/tool execution), single source of truth; push events do increments, get_status calibrates
	const [busy, setBusy] = createSignal(false);
	// The partner whose run is in progress (from get_status / agent_turn); busy shows only for it.
	const [runningPartner, setRunningPartner] = createSignal<string | null>(null);
	// Per-partner busy: true only when the agent is running AND the running partner is the one selected
	// (or unknown). Fixes: switching from A (writing) to B no longer shows B as writing.
	const isBusyForSelected = () => busy() && (runningPartner() === null || runningPartner() === selected());
	// Per-partner writing state for the list rows: the run's owner shows dots even when not selected
	const workingFor = (name: string) => busy() && (runningPartner() === null ? selected() === name : runningPartner() === name);
	const [queued, setQueued] = createSignal(0);
	// A message to the selected chat is queued behind another partner's run (bun-side pendingChats)
	const [queuedCross, setQueuedCross] = createSignal(false);
	const [tick, setTick] = createSignal(0);
	const [selected, setSelected] = createSignal<string | null>(null);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [showModal, setShowModal] = createSignal(false);
	const [settings, setSettings] = createSignal<SettingsData | null>(null);
	const [runtime, setRuntime] = createSignal<{ model: string; apiKeyConfigured: boolean } | null>(null);
	const [listCollapsed, setListCollapsed] = createSignal(localStorage.getItem("chatlist.collapsed") === "1");
	// Per-chat composer drafts: written on every keystroke, restored when the chat is re-selected
	const [drafts, setDrafts] = createSignal<Record<string, string>>({});
	function onDraftChange(text: string) {
		const name = selected();
		if (!name) return;
		setDrafts((d) => ({ ...d, [name]: text }));
	}
	function clearDraft(name: string) {
		setDrafts((d) => {
			const { [name]: _drop, ...rest } = d;
			return rest;
		});
	}
	function toggleListCollapsed() {
		const next = !listCollapsed();
		setListCollapsed(next);
		localStorage.setItem("chatlist.collapsed", next ? "1" : "0");
	}
	let lastMsgTime = 0;

	const bump = () => setTick((t) => t + 1);
	const push = (entry: Entry) => {
		setEntries((prev) => [...prev, entry]);
		bump();
	};

	// ————— RPC helpers —————
	// Render source = the persisted JSONL; dedupe by id, only append new records
	const renderedIds = new Set<string>();
	async function refreshHistory() {
		const { items } = await rpc.request.history({});
		const fresh = items.filter((item) => !renderedIds.has(item.id));
		for (const item of fresh) {
			renderedIds.add(item.id);
			maybeTimeSeparator(new Date(item.time));
			push(item.kind === "user" ? makeUserEntry(item.text, item.time) : makeAgentEntry(item.text, item.time));
		}
	}

	// ————— Trajectory —————
	// Full trajectory cache: invalidated when new data is persisted or the partner switches; refetched on the next open
	let trajectoryCache: TrajectoryRecord[] | null = null;
	async function ensureTrajectory(): Promise<TrajectoryRecord[]> {
		if (trajectoryCache === null) {
			const res = await rpc.request.trajectory({});
			trajectoryCache = res.records;
		}
		return trajectoryCache;
	}
	// Locate flash: the target bubble briefly flashes seal-soft (replies outline locate)
	const [flashId, setFlashId] = createSignal<number | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	const onFlash = (id: number) => {
		setFlashId(id);
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => setFlashId(null), 1200);
	};
	// Open the drawer (the whole log renders inside; no chat linkage)
	async function onViewTrajectory() {
		const records = await ensureTrajectory();
		setTrajectoryRecords(records);
		setTrajectoryOpen(true);
	}

	const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
	const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
	function maybeTimeSeparator(d: Date) {
		if (lastMsgTime && d.getTime() - lastMsgTime > SEPARATOR_GAP_MS) {
			push(makeSepEntry(`${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`));
		}
		lastMsgTime = d.getTime();
	}

	async function refreshPartners() {
		const { partners: list } = await rpc.request.list_partners({});
		setPartners(list);
		// Select the first Partner by default; clear when the selected one disappears
		if (selected() == null && list.length > 0) selectPartner(list[0]);
		if (selected() != null && !list.some((p) => p.name === selected())) selectPartner(null);
	}

	function selectPartner(partner: PartnerItem | null) {
		setSelected(partner?.name ?? null);
		setEntries([]);
		renderedIds.clear();
		lastMsgTime = 0;
		trajectoryCache = null;
		void rpc.request
			.set_partner({
				profile: partner ? { name: partner.name, responsibilities: partner.responsibilities, tones: partner.tones } : null,
			})
			.then(() => {
				refreshHistory();
				// The session is loaded now (entries restored from JSONL): refresh the context meter too,
				// so persisted usage survives restart instead of sitting at 0% until the next turn.
				void refreshContextUsage();
			});
	}

	async function refreshSettings() {
		const { settings: s, runtime: r } = await rpc.request.get_settings({});
		setSettings(s);
		setRuntime(r);
	}

	// ————— RPC events —————
	rpc.addMessageListener("agent_turn", ({ turn: t, partner }) => {
		setBusy(true);
		if (partner != null) setRunningPartner(partner);
		else if (runningPartner() === null) setRunningPartner(selected());
		if (queued() > 0 && runningPartner() === selected()) {
			setQueued((q) => q - 1);
			push(makeSysEntry(`✳ follow-up · turn ${t}`));
		}
		bump();
	});

	rpc.addMessageListener("agent_message", () => {
		// send_message is persisted; both chat and trajectory may have new content
		trajectoryCache = null;
		void refreshHistory();
		// …and the chat-list row preview (last message) may have changed
		void refreshPartners();
	});

	rpc.addMessageListener("trajectory_update", () => {
		// A turn has been persisted; invalidate the trajectory cache (next click fetches the latest)
		trajectoryCache = null;
		// …and refresh the context meter (usage is persisted per turn)
		void refreshContextUsage();
	});

	rpc.addMessageListener("agent_end", ({ error: err }) => {
		setQueued(0);
		setQueuedCross(false);
		if (err && runningPartner() === selected()) push(makeSysEntry(`ERR § ${err}`, true));
		bump();
		setRunningPartner(null);
		calibrateBusy();
		void refreshContextUsage();
	});

	// Calibrate: the bun-side isStreaming is authoritative; covers lost/late push events (e.g. the startup race where mount lags the first turn)
	function calibrateBusy() {
		void rpc.request.get_status({}).then((s) => {
			setBusy(s.streaming);
			setRunningPartner(s.running_partner);
			setWorkspacePath(s.workspace_path);
		});
	}

	rpc.addMessageListener("workspace_update", () => {
		// The workspace was set via set_workspace; refetch status to show it near the input
		void rpc.request.get_status({}).then((s) => {
			setBusy(s.streaming);
			setRunningPartner(s.running_partner);
			setWorkspacePath(s.workspace_path);
		});
	});

	// ————— context usage (composer meter) + session stats —————
	async function refreshContextUsage() {
		const [usage, s] = await Promise.all([rpc.request.context_usage({}), rpc.request.stats({})]);
		setContextUsage(usage);
		setStats(s);
	}

	// ————— user input —————
	function onSend(text: string) {
		if (isBusyForSelected()) {
			push(makeSysEntry("✳ follow-up queued"));
			setQueued((q) => q + 1);
		}
		void rpc.request.chat({ text }).then((res) => {
			// Cross-partner sends are queued on the bun side (another partner's run owns the agent);
			// the message starts a fresh run once that run settles.
			if (res.queued) {
				setQueuedCross(true);
				push(makeSysEntry("✳ queued — starts after the current run settles"));
			}
			if (res.accepted) clearDraft(selected()!);
			refreshHistory();
		});
	}

	// ————— Partner deletion —————
	async function onDeletePartner(name: string) {
		await rpc.request.delete_partner({ name });
		// If the deleted Partner was selected: close it immediately (reset selection and prompt)
		if (selected() === name) selectPartner(null);
		void refreshPartners();
	}

	// ————— Partner creation —————
	async function onCreatePartner(data: PartnerFormData): Promise<string | null> {
		const res = await rpc.request.create_partner(data);
		if (res.ok) {
			setShowModal(false);
			void refreshPartners();
			return null;
		}
		return res.error ?? "Failed to create partner";
	}

	// ————— mount —————
	void refreshHistory();
	void refreshPartners();
	void refreshSettings();
	calibrateBusy();
	void refreshContextUsage();

	// ————— shell —————
	return (
		<div class="relative flex flex-1 min-h-0">
			<AppRail active={view()} onSelect={(tab) => (tab === "settings" ? setSettingsOpen(true) : setView("chat"))} />

			<main class="flex-1 flex flex-col min-w-0 bg-qw-bg">
				<ConversationPage
					partners={partners()}
					selected={selected()}
					onSelect={(name) => selectPartner(partners().find((p) => p.name === name) ?? null)}
					onAddPartner={() => setShowModal(true)}
					onDelete={onDeletePartner}
					onViewDetails={(name) => setDetailsPartner(partners().find((p) => p.name === name) ?? null)}
					listCollapsed={listCollapsed()}
					onToggleList={toggleListCollapsed}
					entries={entries}
					working={isBusyForSelected}
					tick={tick}
					busy={isBusyForSelected}
					onSend={onSend}
					onStop={() => void rpc.request.stop({})}
					onViewTrajectory={onViewTrajectory}
					flashId={flashId}
					onFlash={onFlash}
					workspacePath={workspacePath()}
					contextUsage={contextUsage()}
					stats={stats()}
					queued={queuedCross()}
					workingFor={workingFor}
					draft={selected() ? (drafts()[selected()!] ?? "") : ""}
					onDraftChange={onDraftChange}
				/>
			</main>

			{/* Settings: dialog */}
			<Dialog open={settingsOpen()} onOpenChange={setSettingsOpen}>
				<DialogContent class="w-[440px] bg-white border-print-line">
					<DialogHeader>
						<DialogTitle>Settings</DialogTitle>
					</DialogHeader>
					<SettingsView
						settings={settings()}
						runtime={runtime()}
						onLoad={() => void refreshSettings()}
						onSave={async (s) => {
							await rpc.request.update_settings({ settings: s });
							setSettings(s);
						}}
					/>
				</DialogContent>
			</Dialog>

			<PartnerModal open={showModal()} onOpenChange={setShowModal} onConfirm={onCreatePartner} existingNames={partners().map((p) => p.name)} />

			<PartnerDetailsDialog partner={detailsPartner()} onOpenChange={(open) => !open && setDetailsPartner(null)} />

			<TrajectoryDrawer open={trajectoryOpen()} onOpenChange={setTrajectoryOpen} records={trajectoryRecords()} />
		</div>
	);
}
