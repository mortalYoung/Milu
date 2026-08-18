/**
 * App — the controller. Owns app state, wires RPC events into visible
 * transcript entries, and renders the shell: icon rail + chat / settings views.
 * Partners are created via a modal and saved as folders (see src/bun/partners.ts).
 */

import { Electroview } from "electrobun/view";
import { createSignal } from "solid-js";
import type { AppRPCSchema, TrajectoryRecord } from "../shared/rpc";
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
}

export function App() {
	// ————— state —————
	const [view, setView] = createSignal<"chat" | "settings">("chat");
	const [settingsOpen, setSettingsOpen] = createSignal(false);
	// Partner details dialog (shared by the list menu / header click)
	const [detailsPartner, setDetailsPartner] = createSignal<PartnerItem | null>(null);
	// Trajectory drawer (density strip): whole-conversation view, linked to the chat
	const [trajectoryOpen, setTrajectoryOpen] = createSignal(false);
	const [trajectoryRecords, setTrajectoryRecords] = createSignal<TrajectoryRecord[]>([]);
	const [focusMessageId, setFocusMessageId] = createSignal<string | null>(null);
	const [visibleReplyId, setVisibleReplyId] = createSignal<string | null>(null);
	const [workspacePath, setWorkspacePath] = createSignal<string | null>(null);
	const [entries, setEntries] = createSignal<Entry[]>([]);
	// busy = whether the agent is running (streaming/tool execution), single source of truth; push events do increments, get_status calibrates
	const [busy, setBusy] = createSignal(false);
	const [queued, setQueued] = createSignal(0);
	const [tick, setTick] = createSignal(0);
	const [selected, setSelected] = createSignal<string | null>(null);
	const [partners, setPartners] = createSignal<PartnerItem[]>([]);
	const [showModal, setShowModal] = createSignal(false);
	const [settings, setSettings] = createSignal<SettingsData | null>(null);
	const [runtime, setRuntime] = createSignal<{ model: string; apiKeyConfigured: boolean } | null>(null);
	const [listCollapsed, setListCollapsed] = createSignal(localStorage.getItem("chatlist.collapsed") === "1");
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
			push(item.kind === "user" ? makeUserEntry(item.text, item.time, item.id) : makeAgentEntry(item.text, item.time, item.id));
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
	// Locate flash: the target bubble briefly flashes seal-soft (shared by outline and trajectory drawer)
	const [flashId, setFlashId] = createSignal<number | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	const onFlash = (id: number) => {
		setFlashId(id);
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => setFlashId(null), 1200);
	};
	// Scroll the chat to a message by its pi id (the drawer links turns to chat bubbles)
	function locateByPi(piId: string) {
		const entry = entries().find((e) => e.piId === piId);
		if (!entry) return;
		document.getElementById("entry-" + entry.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
		onFlash(entry.id);
	}
	// Open the drawer; a message link additionally focuses that turn and scrolls to it
	async function onViewTrajectory(piId?: string) {
		const records = await ensureTrajectory();
		setTrajectoryRecords(records);
		if (piId) {
			setFocusMessageId(piId);
			locateByPi(piId);
		}
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
			.then(() => refreshHistory());
	}

	async function refreshSettings() {
		const { settings: s, runtime: r } = await rpc.request.get_settings({});
		setSettings(s);
		setRuntime(r);
	}

	// ————— RPC events —————
	rpc.addMessageListener("agent_turn", ({ turn: t }) => {
		setBusy(true);
		if (queued() > 0) {
			setQueued((q) => q - 1);
			push(makeSysEntry(`✳ follow-up · turn ${t}`));
		}
		bump();
	});

	rpc.addMessageListener("agent_message", () => {
		// send_message is persisted; both chat and trajectory may have new content
		trajectoryCache = null;
		void refreshHistory();
	});

	rpc.addMessageListener("trajectory_update", () => {
		// A turn has been persisted; invalidate the trajectory cache (next click fetches the latest)
		trajectoryCache = null;
	});

	rpc.addMessageListener("agent_end", ({ error: err }) => {
		setQueued(0);
		if (err) push(makeSysEntry(`ERR § ${err}`, true));
		bump();
		calibrateBusy();
	});

	// Calibrate: the bun-side isStreaming is authoritative; covers lost/late push events (e.g. the startup race where mount lags the first turn)
	function calibrateBusy() {
		void rpc.request.get_status({}).then((s) => {
			setBusy(s.streaming);
			setWorkspacePath(s.workspace_path);
		});
	}

	rpc.addMessageListener("workspace_update", () => {
		// The workspace was set via set_workspace; refetch status to show it near the input
		void rpc.request.get_status({}).then((s) => setWorkspacePath(s.workspace_path));
	});

	// ————— user input —————
	function onSend(text: string) {
		if (busy()) {
			push(makeSysEntry("✳ follow-up queued"));
			setQueued((q) => q + 1);
		}
		void rpc.request.chat({ text }).then(() => refreshHistory());
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

	// Preview = the assembled four-section system prompt (identify/tool-guidance shown read-only in the result)
	function onPreviewPrompt(data: PartnerFormData): Promise<string> {
		return rpc.request
			.preview_system_prompt({
				profile: { responsibilities: data.responsibilities, tones: data.tones },
			})
			.then((res) => res.prompt);
	}

	// ————— mount —————
	void refreshHistory();
	void refreshPartners();
	void refreshSettings();
	calibrateBusy();

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
					working={busy}
					tick={tick}
					busy={busy}
					onSend={onSend}
					onStop={() => void rpc.request.stop({})}
					onViewTrajectory={onViewTrajectory}
					flashId={flashId}
					onFlash={onFlash}
					onVisibleReply={setVisibleReplyId}
					workspacePath={workspacePath()}
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

			<PartnerModal open={showModal()} onOpenChange={setShowModal} onConfirm={onCreatePartner} onPreview={onPreviewPrompt} existingNames={partners().map((p) => p.name)} />

			<PartnerDetailsDialog partner={detailsPartner()} onOpenChange={(open) => !open && setDetailsPartner(null)} />

			<TrajectoryDrawer
				open={trajectoryOpen()}
				onOpenChange={setTrajectoryOpen}
				records={trajectoryRecords()}
				onLocate={locateByPi}
				visibleReplyId={visibleReplyId}
				focusMessageId={focusMessageId}
				onFocusConsumed={() => setFocusMessageId(null)}
			/>
		</div>
	);
}
