import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { AppHeader } from "./components/AppHeader";
import { AppRail, type RailTabId } from "./components/AppRail";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { ConversationList } from "./components/ConversationList";
import { ExplorerDrawer } from "./components/ExplorerDrawer";
import { GitChangesDrawer } from "./components/GitChangesDrawer";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { PartnerModal } from "./components/PartnerModal";
import { RepliesPane } from "./components/RepliesPane";
import { SessionBar } from "./components/SessionBar";
import { TaskLogDialog } from "./components/TaskLogDialog";
import { ToastHost } from "./components/ToastHost";
import { TrajectoryDrawer } from "./components/TrajectoryDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { TooltipProvider } from "./components/ui/tooltip";
import { Transcript } from "./layouts/Transcript";
import { AgentStatusProvider } from "./lib/contexts/agent-status-context";
import { CommandDirectoryProvider } from "./lib/contexts/commands-context";
import { ComposerProvider } from "./lib/contexts/composer-context";
import { DashboardProvider } from "./lib/contexts/dashboard-context";
import { InboxProvider } from "./lib/contexts/inbox-context";
import { MetricsProvider } from "./lib/contexts/metrics-context";
import { ScrollProvider } from "./lib/contexts/scroll-context";
import { SessionProvider } from "./lib/contexts/session-context";
import { SettingsProvider, useSettings } from "./lib/contexts/settings-context";
import { SkillsProvider } from "./lib/contexts/skills-context";
import { ToastProvider } from "./lib/contexts/toast-context";
import { TrajectoryProvider } from "./lib/contexts/trajectory-context";
import { TranscriptProvider } from "./lib/contexts/transcript-context";
import {
	commands as commandDirectory,
	composer,
	dashboard,
	dock,
	inbox,
	metrics,
	palette,
	scroll,
	selectPartner,
	session,
	settings,
	skills,
	status,
	tasks as tasksCtl,
	toast,
	trajectory,
	transcript,
	unread,
} from "./lib/controllers";
import { ESCAPE_ORDER, type EscapeLayer, escapeTop } from "./lib/escape";
import { useKeybindings } from "./lib/keybindings";
import type { PartnerFormData } from "./lib/partner-form";
import { rpc } from "./lib/rpc";
import type { PartnerItem } from "./lib/session";
import { DashboardView } from "./pages/DashboardView";
import { SettingsView } from "./pages/SettingsView";
import { SkillsView } from "./pages/SkillsView";

const escapeLayers: EscapeLayer[] = [
	{ id: "palette", order: ESCAPE_ORDER.palette, isOpen: () => palette.store.getState().open, close: () => palette.close() },
	{ id: "trajectory", order: ESCAPE_ORDER.trajectory, isOpen: () => trajectory.store.getState().open, close: () => trajectory.mutate.setOpen(false) },
	{ id: "dock", order: ESCAPE_ORDER.dock, isOpen: () => dock.panel() != null, close: () => dock.close() },
];

async function onDeletePartner(name: string) {
	await rpc.request.delete_partner({ name });
	const state = session.store.getState();
	const selected = state.selected;
	const selectedIsDeleted = selected === name || state.partners.find((p) => p.name === selected)?.forkedFrom === name;
	if (selectedIsDeleted) selectPartner(null);
	void session.mutate.refreshPartners();
}

async function runCopy(kind: "duplicate" | "fork", name: string) {
	const res = kind === "duplicate" ? await rpc.request.duplicate_partner({ name }) : await rpc.request.fork_partner({ name });
	if (!res.ok || !res.profile) {
		toast.push({ title: kind === "duplicate" ? "Duplicate failed" : "Fork failed", body: res.error ?? "Unknown error" }, "error");
		return;
	}
	toast.push({ title: kind === "duplicate" ? "Duplicated" : "Forked", body: `Now working as ${res.profile.name}` });
	await session.mutate.refreshPartners();
	selectPartner(res.profile);
}

async function onPromotePartner(name: string) {
	const res = await rpc.request.promote_partner({ name });
	if (!res.ok || !res.profile) {
		toast.push({ title: "Promote failed", body: res.error ?? "Unknown error" }, "error");
		return;
	}
	toast.push({ title: `Promoted "${name}"`, body: "Now a root chat" });
	await session.mutate.refreshPartners();
}

function onSend(text: string) {
	scroll.pin(true);
	void rpc.request.chat({ text }).then((res) => {
		if (res.accepted) composer.clear(session.store.getState().selected ?? "");
		void session.mutate.refreshHistory();
	});
}

async function onCreatePartner(data: PartnerFormData): Promise<string | null> {
	const res = await rpc.request.create_partner(data);
	if (!res.ok) return res.error ?? "Failed to create partner";
	void session.mutate.refreshPartners();
	if (res.profile) selectPartner(res.profile);
	return null;
}

function onOpenPath(path: string, editorId?: string) {
	void rpc.request.open_path({ path, editorId }).then((res) => {
		if (!res.ok) toast.push({ title: "Couldn't open folder", body: res.error ?? "No supported editor found" }, "error");
	});
}

function ChatView(props: {
	selected: string | null;
	editors: { id: string; name: string }[];
	onViewDetails: (name: string) => void;
	listCollapsed: boolean;
	onToggleList: () => void;
}) {
	const settingsCtl = useSettings();
	const settingsSnapshot = useStore(settingsCtl.store, (state) => state.snapshot);
	const partners = useStore(session.store, (state) => state.partners);
	const writing = useStore(status.store, (state) => state.writing);
	const loading = useStore(session.historyLoading.store, (state) => state.loading);
	const readAt = useStore(unread.store, (state) => state.readAt);
	const panels = useStore(dock.store, (state) => state.panels);
	const pins = useStore(dock.store, (state) => state.pins);
	const reveal = useStore(dock.store, (state) => state.reveal);
	const paneWidth = useStore(dock.store, (state) => state.paneWidth);
	const letterWidth = useStore(dock.store, (state) => state.letterWidth);
	const wrap = useStore(dock.store, (state) => state.wrap);
	const sideBySide = useStore(dock.store, (state) => state.sideBySide);
	const agentSnapshot = useStore(status.store, (state) => state.snapshot);
	const workspaceReady = useStore(status.store, (state) => state.snapshot.partner) === props.selected;

	const [btwAnchor, setBtwAnchor] = useState<string | null>(null);
	const [composerHeight, setComposerHeight] = useState(0);
	const [taskOpen, setTaskOpen] = useState(false);
	const taskVersion = useStore(tasksCtl.store, (state) => state.version);
	const taskOutput = useStore(tasksCtl.store, (state) => state.output);
	const taskList = useStore(tasksCtl.store, (state) => state.tasks);
	const composerObserver = useRef<ResizeObserver | null>(null);

	const selected = props.selected;
	const panel = selected ? (panels[selected] ?? null) : null;
	const pinnedAt = (which: "explorer" | "git" | "replies") => selected != null && pins[selected]?.[which] === true;
	const dockSide = settingsSnapshot.settings?.dockSide ?? "right";
	const busy = selected ? (writing[selected] ?? partners.find((p) => p.name === selected)?.writing ?? false) : false;

	function bindComposerSlot(el: HTMLDivElement | null) {
		composerObserver.current?.disconnect();
		composerObserver.current = null;
		if (!el) return;
		const observer = new ResizeObserver(() => setComposerHeight(el.clientHeight));
		observer.observe(el);
		composerObserver.current = observer;
		setComposerHeight(el.clientHeight);
	}

	useEffect(() => () => composerObserver.current?.disconnect(), []);

	useEffect(() => {
		if (!workspaceReady) return;
		if (agentSnapshot.workspace_path == null && dock.panel() === "explorer") dock.close();
	}, [workspaceReady, agentSnapshot, selected]);

	useEffect(() => {
		if (!workspaceReady) return;
		const gitAvailable = agentSnapshot.workspace_path != null && agentSnapshot.is_git_repo;
		if ((!gitAvailable || agentSnapshot.change_count === 0) && dock.panel() === "git") dock.close();
	}, [workspaceReady, agentSnapshot, selected]);

	useEffect(() => {
		setBtwAnchor(null);
		trajectory.mutate.setOpen(false);
	}, [selected]);

	useEffect(() => {
		void tasksCtl.refresh(selected);
	}, [selected, taskVersion]);

	const isUnread = (name: string) => {
		const partner = partners.find((p) => p.name === name);
		return partner?.lastMessageAt != null && partner.lastMessageAt > (readAt[name] ?? 0);
	};

	return (
		<div className="chat-page">
			<MotionConfig reducedMotion="user">
				<AnimatePresence initial={false}>
					{!props.listCollapsed && (
						<motion.div
							key="chat-list"
							className="conv-pane"
							initial={{ width: 0 }}
							animate={{ width: "15rem" }}
							exit={{ width: 0, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
							transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
						>
							<ConversationList
								partners={partners}
								selected={selected}
								unread={isUnread}
								onSelect={(name) => selectPartner(partners.find((p) => p.name === name) ?? null)}
								onAddPartner={() => {}}
								onDelete={(name) => void onDeletePartner(name)}
								onViewDetails={props.onViewDetails}
								onDuplicate={(name) => void runCopy("duplicate", name)}
								onFork={(name) => void runCopy("fork", name)}
								onPromote={(name) => void onPromotePartner(name)}
							/>
						</motion.div>
					)}
				</AnimatePresence>
			</MotionConfig>
			<div className="chat-window">
				{selected ? (
					<div className={"chat-body" + (btwAnchor ? " btw-open" : "")}>
						<div
							className={"chat-main" + (pinnedAt("explorer") || pinnedAt("git") ? " pinned" : "") + (dockSide === "left" ? " side-left" : "")}
							style={{ "--dock-bottom": `${composerHeight}px`, ...(letterWidth != null ? { "--letter-width": `${letterWidth}px` } : {}) } as React.CSSProperties}
						>
							<div className="chat-letter">
								<div className="chat-transcript-region">
									<Transcript
										working={busy}
										historyLoading={loading}
										worker={selected}
										onEscalationRespond={(id, approved) => void rpc.request.sandbox_respond({ id, approved })}
										onBtw={setBtwAnchor}
										onBtwClose={() => setBtwAnchor(null)}
										activeBtwAnchor={btwAnchor}
									/>
								</div>
								<div className="composer-slot" ref={bindComposerSlot}>
									<Composer
										onSend={onSend}
										onStop={() => void rpc.request.stop({})}
										onShell={(command) => {
											scroll.pin(true);
											return rpc.request.shell_execute({ command });
										}}
										onOpenPath={onOpenPath}
										onTasks={() => setTaskOpen(true)}
										hasTasks={taskList.length > 0}
										taskRunning={taskList.filter((task) => task.status === "running").length}
										editors={props.editors}
									/>
									<TaskLogDialog open={taskOpen} onOpenChange={setTaskOpen} tasks={taskList} partner={selected} version={taskVersion} output={taskOutput} />
								</div>
							</div>
							<ExplorerDrawer
								open={panel === "explorer"}
								partner={selected}
								reveal={reveal}
								side={dockSide}
								pinned={pinnedAt("explorer")}
								onTogglePin={() => dock.togglePinned(selected, "explorer")}
								letterWidth={letterWidth}
								setLetterWidth={dock.setLetterWidth}
								commitLetterWidth={dock.commitLetterWidth}
								paneWidth={paneWidth}
								onPaneResize={dock.setPaneWidth}
								onPaneCommit={dock.commitPaneWidth}
								wrap={wrap}
								onToggleWrap={dock.toggleWrap}
								onClose={() => dock.close()}
							/>
							<GitChangesDrawer
								open={panel === "git"}
								partner={selected}
								side={dockSide}
								onClose={() => dock.close()}
								paneWidth={paneWidth}
								onPaneResize={dock.setPaneWidth}
								onPaneCommit={dock.commitPaneWidth}
								pinned={pinnedAt("git")}
								onTogglePin={() => dock.togglePinned(selected, "git")}
								letterWidth={letterWidth}
								setLetterWidth={dock.setLetterWidth}
								commitLetterWidth={dock.commitLetterWidth}
								sideBySide={sideBySide}
								onToggleSideBySide={dock.toggleSideBySide}
								wrap={wrap}
								onToggleWrap={dock.toggleWrap}
							/>
						</div>
					</div>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
						<p className="font-serif text-[17px] text-ink-soft">— select a partner to begin —</p>
						<p className="eyebrow">the directory is on the left</p>
					</div>
				)}
			</div>
			<RepliesPane open={panel === "replies"} />
			<TrajectoryDrawer />
		</div>
	);
}

function closeCurrentChat() {
	if (!session.store.getState().selected) return;
	selectPartner(null);
}

export function App() {
	const [view, setView] = useState<RailTabId>("chat");
	const [editors, setEditors] = useState<{ id: string; name: string }[]>([]);
	const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem("chatlist.collapsed") === "1");
	const [showModal, setShowModal] = useState(false);
	const [detailsPartner, setDetailsPartner] = useState<PartnerItem | null>(null);

	const selected = useStore(session.store, (state) => state.selected);
	const partners = useStore(session.store, (state) => state.partners);
	const readAt = useStore(unread.store, (state) => state.readAt);
	const agentSnapshot = useStore(status.store, (state) => state.snapshot);
	const toasts = useStore(toast.store, (state) => state.toasts);
	const settingsOpen = useStore(settings.store, (state) => state.open);
	const settingsSnapshot = useStore(settings.store, (state) => state.snapshot);
	void palette;

	useEffect(() => {
		void rpc.request.list_editors({}).then((res) => setEditors(res.editors));
	}, []);

	const toggleList = () => {
		setListCollapsed((collapsed) => {
			const next = !collapsed;
			localStorage.setItem("chatlist.collapsed", next ? "1" : "0");
			return next;
		});
	};

	useKeybindings([
		{
			key: "Escape",
			handler: (event) => {
				const handledAbove = event.defaultPrevented;
				event.preventDefault();
				if (handledAbove) return;
				escapeTop(escapeLayers);
			},
		},
		{ key: ",", meta: true, handler: () => settings.mutate.setOpen(true) },
		{ key: "b", meta: true, handler: () => toggleList() },
		{ key: "n", meta: true, handler: () => openAddPartner() },
		{ key: "w", meta: true, handler: () => closeCurrentChat() },
		{ key: "e", meta: true, handler: () => selected && openDetails(selected) },
		{ key: "p", meta: true, shift: true, handler: () => palette.launch("access") },
		{ key: "p", meta: true, handler: () => palette.launch() },
	]);

	useEffect(() => {
		rpc.addMessageListener("menu_command", ({ action }) => {
			if (action === "letters.view-chat" || action === "letters.view-skills" || action === "letters.view-dashboard") {
				setView(action.slice("letters.view-".length) as RailTabId);
				return;
			}
			if (action === "letters.settings") {
				settings.mutate.setOpen(true);
				return;
			}
			if (action === "letters.palette" || action === "letters.access") {
				palette.launch(action === "letters.palette" ? "sessions" : "access");
				return;
			}
			setView("chat");
			switch (action) {
				case "letters.new-partner":
					openAddPartner();
					return;
				case "letters.details":
					if (selected) openDetails(selected);
					return;
				case "letters.close-chat":
					closeCurrentChat();
					return;
				case "letters.trajectory":
					trajectory.mutate.setOpen(true);
					return;
				case "letters.replies":
					dock.open("replies");
					return;
				case "letters.runtime-config":
					composer.setPanelOpen(true);
					return;
				case "letters.workspace":
					dock.open("explorer");
					return;
				case "letters.git-changes":
					dock.open("git");
					return;
				case "letters.toggle-list":
					toggleList();
			}
		});
	}, []);

	const modalOpen = settingsOpen || detailsPartner != null;
	const openAddPartner = () => {
		if (view !== "chat" || modalOpen) return;
		setShowModal(true);
	};
	const openDetails = (name: string) => setDetailsPartner(partners.find((p) => p.name === name) ?? null);

	const isUnread = (name: string) => {
		const partner = partners.find((p) => p.name === name);
		return partner?.lastMessageAt != null && partner.lastMessageAt > (readAt[name] ?? 0);
	};

	return (
		<SessionProvider value={session}>
			<ToastProvider value={toast}>
				<SkillsProvider value={skills}>
					<AgentStatusProvider value={status}>
						<ComposerProvider value={composer}>
							<CommandDirectoryProvider value={commandDirectory}>
								<MetricsProvider value={metrics}>
									<SettingsProvider value={settings}>
										<DashboardProvider value={dashboard}>
											<InboxProvider value={inbox}>
												<TrajectoryProvider value={trajectory}>
													<TranscriptProvider value={transcript}>
														<ScrollProvider value={scroll}>
															<TooltipProvider>
																<div className="flex min-h-0 flex-1 flex-col">
																	{view === "chat" ? (
																		<AppHeader dock={dock} selected={selected} onViewDetails={openDetails} listCollapsed={listCollapsed} onToggleList={toggleList} />
																	) : (
																		<SessionBar view={view} />
																	)}
																	<div className="relative flex min-h-0 flex-1">
																		<AppRail active={view} onSelect={setView} />
																		<main className="flex min-w-0 flex-1 flex-col bg-qw-bg">
																			{view === "chat" ? (
																				<ChatView selected={selected} editors={editors} onViewDetails={openDetails} listCollapsed={listCollapsed} onToggleList={toggleList} />
																			) : view === "dashboard" ? (
																				<DashboardView unread={isUnread} onSelect={(name) => selectPartner(partners.find((p) => p.name === name) ?? null)} />
																			) : view === "skills" ? (
																				<SkillsView />
																			) : (
																				<div className="grid flex-1 place-items-center">
																					<span className="font-mono text-[11px] text-muted">{view}</span>
																				</div>
																			)}
																			<ToastHost toasts={toasts} placement={settingsSnapshot.settings?.toastPlacement ?? "bottomcenter"} onDismiss={toast.dismiss} />
																		</main>
																	</div>
																</div>
																<Dialog open={settingsOpen} onOpenChange={settings.mutate.setOpen}>
																	<DialogContent className="w-[820px] max-w-none h-[640px] grid-rows-[auto_1fr] overflow-hidden bg-letter border-print-line p-0">
																		<DialogHeader className="px-4 pt-4">
																			<DialogTitle className="font-serif text-[15px]">Settings</DialogTitle>
																		</DialogHeader>
																		<SettingsView />
																	</DialogContent>
																</Dialog>
																<PartnerModal open={showModal} onOpenChange={setShowModal} onConfirm={onCreatePartner} existingNames={partners.map((p) => p.name)} />
																<PartnerDetailsDialog
																	partner={detailsPartner}
																	onOpenChange={(open) => !open && setDetailsPartner(null)}
																	onOpenPath={onOpenPath}
																	editors={editors}
																/>
																<CommandPalette
																	palette={palette}
																	partner={selected}
																	partners={partners}
																	hasWorkspace={agentSnapshot.workspace_path != null}
																	unread={isUnread}
																	onSelectPartner={(name) => {
																		settings.mutate.setOpen(false);
																		setView("chat");
																		selectPartner(partners.find((p) => p.name === name) ?? null);
																	}}
																	onRevealFile={(path, range) => dock.revealInExplorer(path, range)}
																	onOpenFile={(path) => {
																		settings.mutate.setOpen(false);
																		void rpc.request.open_path({ path }).then((res) => {
																			if (!res.ok) toast.push({ title: "Couldn't open file", body: res.error ?? "No supported editor found" }, "error");
																		});
																	}}
																/>
															</TooltipProvider>
														</ScrollProvider>
													</TranscriptProvider>
												</TrajectoryProvider>
											</InboxProvider>
										</DashboardProvider>
									</SettingsProvider>
								</MetricsProvider>
							</CommandDirectoryProvider>
						</ComposerProvider>
					</AgentStatusProvider>
				</SkillsProvider>
			</ToastProvider>
		</SessionProvider>
	);
}
