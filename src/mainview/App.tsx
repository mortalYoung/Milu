import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { RailView } from "../shared/rpc";
import { AppSidebar } from "./components/AppSidebar";
import { ChatPaneBar } from "./components/ChatPaneBar";
import { CommandPalette } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { DockGrip } from "./components/DockGrip";
import { ExplorerDrawer } from "./components/ExplorerDrawer";
import { GitChangesDrawer } from "./components/GitChangesDrawer";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { PartnerModal } from "./components/PartnerModal";
import { RepliesPane } from "./components/RepliesPane";
import { TaskLogDialog } from "./components/TaskLogDialog";
import { ToastHost } from "./components/ToastHost";
import { TrajectoryDrawer } from "./components/TrajectoryDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { TooltipProvider } from "./components/ui/tooltip";
import { Transcript } from "./layouts/Transcript";
import { registerSurfaceRoot } from "./lib/active-surface";
import { AgentStatusProvider } from "./lib/contexts/agent-status-context";
import { CommandDirectoryProvider } from "./lib/contexts/commands-context";
import { ComposerProvider } from "./lib/contexts/composer-context";
import { DashboardProvider } from "./lib/contexts/dashboard-context";
import { InboxProvider } from "./lib/contexts/inbox-context";
import { MetricsProvider } from "./lib/contexts/metrics-context";
import { ScrollProvider } from "./lib/contexts/scroll-context";
import { SessionProvider } from "./lib/contexts/session-context";
import { SettingsProvider } from "./lib/contexts/settings-context";
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
	openChat,
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
import { DOCK_MIN, LIST_DEFAULT, LIST_MAX, LIST_MIN, WORKBENCH_MIN, WORKBENCH_TARGET } from "./lib/dock";
import { ESCAPE_ORDER, type EscapeLayer, escapeTop } from "./lib/escape";
import { useFindRouter } from "./lib/find";
import { GRIP_WIDTH } from "./lib/grip";
import { useKeybindings } from "./lib/keybindings";
import { warmUpMarkdown } from "./lib/markdown";
import type { PartnerFormData } from "./lib/partner-form";
import { rpc } from "./lib/rpc";
import type { PartnerItem } from "./lib/session";
import { SURFACE } from "./lib/surfaces";
import { zoomOnDoubleClick } from "./lib/zoom";
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

function onOpenPath(path: string, editorId?: string) {
	void rpc.request.open_path({ path, editorId }).then((res) => {
		if (!res.ok) toast.push({ title: "Couldn't open folder", body: res.error ?? "No supported editor found" }, "error");
	});
}

function ChatView(props: {
	selected: string | null;
	editors: { id: string; name: string }[];
	onViewDetails: (name: string) => void;
	onAddPartner: () => void;
	listCollapsed: boolean;
	onToggleList: () => void;
	onOpenSettings: () => void;
}) {
	const partners = useStore(session.store, (state) => state.partners);
	const partnersLoading = useStore(session.partnersLoading.store, (state) => state.loading);
	const writing = useStore(status.store, (state) => state.writing);
	const loading = useStore(session.historyLoading.store, (state) => state.loading);
	const readAt = useStore(unread.store, (state) => state.readAt);
	const panels = useStore(dock.store, (state) => state.panels);
	const reveal = useStore(dock.store, (state) => state.reveal);
	const dockWidth = useStore(dock.store, (state) => state.dockWidth);
	const paneWidth = useStore(dock.store, (state) => state.paneWidth);
	const wrap = useStore(dock.store, (state) => state.wrap);
	const sideBySide = useStore(dock.store, (state) => state.sideBySide);
	const ignoreWhitespace = useStore(dock.store, (state) => state.ignoreWhitespace);
	const agentSnapshot = useStore(status.store, (state) => state.snapshot);
	const workspaceReady = useStore(status.store, (state) => state.snapshot.partner) === props.selected;

	const emptyWindow = useCallback((element: HTMLDivElement | null) => {
		if (!element) return;
		return registerSurfaceRoot(element, SURFACE.chatList);
	}, []);

	const [btwAnchor, setBtwAnchor] = useState<string | null>(null);
	const [taskOpen, setTaskOpen] = useState(false);
	const taskVersion = useStore(tasksCtl.store, (state) => state.version);
	const taskOutput = useStore(tasksCtl.store, (state) => state.output);
	const taskList = useStore(tasksCtl.store, (state) => state.tasks);
	const listWidth = useStore(dock.store, (state) => state.listWidth);
	const listOpen = useStore(dock.store, (state) => state.listOpen);
	const rowObserver = useRef<ResizeObserver | null>(null);
	const rowEl = useRef<HTMLDivElement>(null);
	const [rowWidth, setRowWidth] = useState(0);

	const selected = props.selected;
	const panel = selected ? (panels[selected] ?? null) : null;
	const docked = panel === "explorer" || panel === "git";
	const busy = selected ? (writing[selected] ?? partners.find((p) => p.name === selected)?.writing ?? false) : false;

	function bindRow(el: HTMLDivElement | null) {
		rowEl.current = el;
		rowObserver.current?.disconnect();
		rowObserver.current = null;
		if (!el) return;
		const observer = new ResizeObserver(() => setRowWidth(el.clientWidth));
		observer.observe(el);
		rowObserver.current = observer;
		setRowWidth(el.clientWidth);
	}

	useEffect(
		() => () => {
			rowObserver.current?.disconnect();
		},
		[],
	);

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

	useEffect(() => {
		if (selected) void inbox.refresh(selected);
	}, [selected]);

	const isUnread = (name: string) => {
		const partner = partners.find((p) => p.name === name);
		return partner?.lastMessageAt != null && partner.lastMessageAt > (readAt[name] ?? 0);
	};

	/* 三个区各守自己的宽：sidebar 与 dock 各自是存好的定值，workbench 是唯一的余量。
	   渲染路径上谁都不夹邻居 —— 所以拖着 sidebar 不会让 dock 变，拖着 dock 也不会让 sidebar 变。 */
	const workbenchFloor = docked ? WORKBENCH_MIN : WORKBENCH_TARGET;
	const listWidthNow = Math.max(LIST_MIN, Math.min(listWidth, LIST_MAX));
	const dockWidthNow = docked ? (rowWidth === 0 ? dockWidth : Math.max(DOCK_MIN, Math.min(dockWidth, rowWidth - 2 * GRIP_WIDTH))) : 0;

	/* 让位（把 chatlist 藏起来）只由"这一行装不下三家的地板"触发，和当前拖到哪儿无关 ——
	   否则拖 dock 就能把 sidebar 拖消失，而反向不会，两个方向就不对称了。 */
	const listHidden = props.listCollapsed || (rowWidth > 0 && docked && rowWidth - 2 * GRIP_WIDTH < LIST_MIN + DOCK_MIN + workbenchFloor);

	const workbenchSpace = Math.max(0, rowWidth - GRIP_WIDTH - (listHidden ? 0 : listWidthNow + GRIP_WIDTH) - (docked ? dockWidthNow + GRIP_WIDTH : 0));

	/* 只有拖动才用"给 workbench 留地板"兜住荒诞值：两个方向同一个公式，只是角色互换。
	   上限不低于当前值 —— 否则在窄窗口里一按下鼠标就会"啪"地缩一下。 */
	const listMax = Math.max(
		LIST_MIN,
		listWidthNow,
		rowWidth === 0 ? LIST_MAX : Math.min(LIST_MAX, rowWidth - GRIP_WIDTH - (docked ? dockWidthNow + GRIP_WIDTH : 0) - workbenchFloor),
	);
	const dockMax = Math.max(DOCK_MIN, dockWidthNow, rowWidth === 0 ? dockWidthNow : rowWidth - GRIP_WIDTH - (listHidden ? 0 : listWidthNow + GRIP_WIDTH) - workbenchFloor);

	/* 拖动时上方那串数字：按左→右列出现在真的在屏上的区（被拖的那个用拖动中的值），
	   所以三栏全开是 `sidebar / workbench / dock`，两栏就是两个数。 */
	function splitReadout(dragged: "list" | "dock", width: number): string {
		const list = listHidden ? 0 : dragged === "list" ? width : listWidthNow;
		const dockNow = docked ? (dragged === "dock" ? width : dockWidthNow) : 0;
		const grips = (list > 0 ? 1 : 0) + (dockNow > 0 ? 1 : 0);
		const workbench = Math.max(0, rowWidth - grips * GRIP_WIDTH - list - dockNow);
		const parts = list > 0 ? [list] : [];
		parts.push(workbench);
		if (dockNow > 0) parts.push(dockNow);
		return parts.map((value) => Math.round(value)).join(" / ");
	}

	return (
		<div className="chat-page" ref={bindRow}>
			<div className={"conv-pane" + (listHidden ? " collapsed" : "")} style={{ width: listHidden ? undefined : listWidthNow }} inert={listHidden}>
				<AppSidebar
					partners={partners}
					loading={partnersLoading}
					selected={selected}
					unread={isUnread}
					onSelect={(name) => selectPartner(partners.find((p) => p.name === name) ?? null)}
					onAddPartner={props.onAddPartner}
					onDelete={(name) => void onDeletePartner(name)}
					onViewDetails={props.onViewDetails}
					onDuplicate={(name) => void runCopy("duplicate", name)}
					onFork={(name) => void runCopy("fork", name)}
					onPromote={(name) => void onPromotePartner(name)}
					onToggleList={props.onToggleList}
					onOpenSettings={props.onOpenSettings}
				/>
			</div>
			{!listHidden && (
				<DockGrip
					class="conv-grip"
					width={() => listWidthNow}
					min={LIST_MIN}
					max={listMax}
					side="left"
					label="Resize the chat list"
					half={() => LIST_DEFAULT}
					readout={(width) => splitReadout("list", width)}
					onResize={dock.setListWidth}
					onCommit={dock.commitListWidth}
				/>
			)}
			<div className="chat-area">
				<ChatPaneBar
					dock={dock}
					selected={selected}
					onViewDetails={props.onViewDetails}
					listCollapsed={props.listCollapsed}
					listHidden={listHidden}
					onToggleList={props.onToggleList}
				/>
				<div className="chat-row">
					{selected ? (
						<div className={"chat-body" + (btwAnchor ? " btw-open" : "")}>
							<div className="chat-main">
								<div className="chat-column">
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
									<div className="composer-slot">
										<Composer
											onSend={onSend}
											onStop={() => void rpc.request.stop({})}
											onShell={(command) => {
												scroll.pin(true);
												return rpc.request.shell_execute({ command });
											}}
											onTasks={() => setTaskOpen(true)}
											hasTasks={taskList.length > 0}
											taskRunning={taskList.filter((task) => task.status === "running").length}
										/>
										<TaskLogDialog open={taskOpen} onOpenChange={setTaskOpen} tasks={taskList} partner={selected} version={taskVersion} output={taskOutput} />
									</div>
								</div>
							</div>
						</div>
					) : (
						<div className="chat-main">
							<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" ref={emptyWindow}>
								<p className="font-serif text-[16px] text-ink-soft">— select a partner to begin —</p>
								<p className="eyebrow">the chat list is on the left</p>
							</div>
						</div>
					)}
					{docked && (
						<DockGrip
							class="dock-grip-edge"
							width={() => dockWidthNow}
							min={DOCK_MIN}
							max={dockMax}
							side="right"
							label="Resize the dock"
							half={() => Math.round((workbenchSpace + dockWidthNow) / 2)}
							readout={(width) => splitReadout("dock", width)}
							onResize={dock.setDockWidth}
							onCommit={dock.commitDockWidth}
						/>
					)}
					{selected && (
						<>
							<ExplorerDrawer
								open={panel === "explorer"}
								partner={selected}
								reveal={reveal}
								width={docked ? dockWidthNow : 0}
								paneWidth={paneWidth}
								listOpen={listOpen}
								onToggleList={dock.toggleListOpen}
								wrap={wrap}
								onToggleWrap={dock.toggleWrap}
							/>
							<GitChangesDrawer
								open={panel === "git"}
								partner={selected}
								width={docked ? dockWidthNow : 0}
								paneWidth={paneWidth}
								listOpen={listOpen}
								onToggleList={dock.toggleListOpen}
								sideBySide={sideBySide}
								onToggleSideBySide={dock.toggleSideBySide}
								wrap={wrap}
								onToggleWrap={dock.toggleWrap}
								ignoreWhitespace={ignoreWhitespace}
								onToggleIgnoreWhitespace={dock.toggleIgnoreWhitespace}
								onRevealInExplorer={(path) => dock.revealInExplorer(path)}
							/>
						</>
					)}
				</div>
			</div>
			<RepliesPane open={panel === "replies"} />
			<TrajectoryDrawer />
		</div>
	);
}

type ViewId = RailView;

function closeCurrentChat() {
	if (!session.store.getState().selected) return;
	selectPartner(null);
}

export function App() {
	const finds = useFindRouter();
	const [view, setView] = useState<ViewId>("chat");
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

	useEffect(() => {
		warmUpMarkdown();
	}, []);

	useEffect(() => {
		void rpc.request.set_view({ view });
	}, [view]);

	useEffect(() => {
		openChat.run = (name) => {
			setView("chat");
			selectPartner(partners.find((p) => p.name === name) ?? null);
		};
	}, [partners]);

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
		{
			key: "f",
			meta: true,
			preventDefault: false,
			handler: (event) => {
				if (finds.dispatch()) event.preventDefault();
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

	const onMenuCommand = useRef<(action: string) => void>(() => {});
	onMenuCommand.current = (action: string) => {
		if (action === "letters.view-chat" || action === "letters.view-skills" || action === "letters.view-dashboard") {
			setView(action.slice("letters.view-".length) as ViewId);
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
			case "letters.workspace":
				dock.open("explorer");
				return;
			case "letters.git-changes":
				dock.open("git");
				return;
			case "letters.toggle-list":
				toggleList();
		}
	};

	useEffect(() => {
		rpc.addMessageListener("menu_command", ({ action }) => onMenuCommand.current(action));
	}, []);

	const modalOpen = settingsOpen || detailsPartner != null;
	const openAddPartner = () => {
		if (view !== "chat" || modalOpen) return;
		setShowModal(true);
	};
	const openDetails = (name: string) => setDetailsPartner(partners.find((p) => p.name === name) ?? null);
	const onCreatePartner = async (data: PartnerFormData): Promise<string | null> => {
		const res = await rpc.request.create_partner(data);
		if (!res.ok) return res.error ?? "Failed to create partner";
		setShowModal(false);
		void session.mutate.refreshPartners();
		if (res.profile) selectPartner(res.profile);
		return null;
	};

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
																	<div className="relative flex min-h-0 flex-1">
																		<div className={"mac-plate" + (listCollapsed || view !== "chat" ? " tinted" : "")} />
																		<main className="flex min-w-0 flex-1 flex-col bg-qw-bg">
																			{view !== "chat" && <div className="view-strip electrobun-webkit-app-region-drag" onDoubleClick={zoomOnDoubleClick} />}
																			{view === "dashboard" ? (
																				<DashboardView unread={isUnread} onSelect={(name) => selectPartner(partners.find((p) => p.name === name) ?? null)} />
																			) : view === "skills" ? (
																				<SkillsView />
																			) : (
																				<ChatView
																					selected={selected}
																					editors={editors}
																					onViewDetails={openDetails}
																					onAddPartner={openAddPartner}
																					listCollapsed={listCollapsed}
																					onToggleList={toggleList}
																					onOpenSettings={() => settings.mutate.setOpen(true)}
																				/>
																			)}
																			<ToastHost toasts={toasts} placement={settingsSnapshot.settings?.toastPlacement ?? "bottomcenter"} onDismiss={toast.dismiss} />
																		</main>
																	</div>
																</div>
																<Dialog open={settingsOpen} onOpenChange={settings.mutate.setOpen}>
																	<DialogContent
																		className="w-[820px] max-w-none h-[640px] grid-rows-[auto_1fr] overflow-hidden bg-surface border-print-line p-0"
																		onOpenAutoFocus={(event) => event.preventDefault()}
																	>
																		<DialogHeader className="px-4 pt-4">
																			<DialogTitle className="font-serif text-[16px]">Settings</DialogTitle>
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
