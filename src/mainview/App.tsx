import { MotionConfig, motion, useReducedMotion, type Variants } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { RailView } from "../shared/rpc";
import { AppSidebar } from "./components/AppSidebar";
import { Button } from "./components/Button";
import { ChatPaneBar } from "./components/ChatPaneBar";
import { CommandPalette } from "./components/CommandPalette";
import { DockGrip } from "./components/DockGrip";
import { ExplorerDrawer } from "./components/ExplorerDrawer";
import { GitChangesDrawer } from "./components/GitChangesDrawer";
import { PartnerDetailsDialog } from "./components/PartnerDetailsDialog";
import { PartnerModal } from "./components/PartnerModal";
import { RepliesPane } from "./components/RepliesPane";
import { ToastHost } from "./components/ToastHost";
import { TrajectoryDrawer } from "./components/TrajectoryDrawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Kbd, KbdGroup } from "./components/ui/kbd";
import { TooltipProvider } from "./components/ui/tooltip";
import { Workbench } from "./layouts/Workbench";
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
	shell,
	skills,
	status,
	tasks as tasksCtl,
	toast,
	trajectory,
	transcript,
	unread,
} from "./lib/controllers";
import { DOCK_MIN, LIST_DEFAULT, LIST_MAX, LIST_MIN, WORKBENCH_MIN } from "./lib/dock";
import { ESCAPE_ORDER, type EscapeLayer, escapeTop } from "./lib/escape";
import { useFindRouter } from "./lib/find";
import { GRIP_WIDTH } from "./lib/grip";
import { useKeybindings } from "./lib/keybindings";
import { warmUpMarkdown } from "./lib/markdown";
import type { PartnerFormData } from "./lib/partner-form";
import { rpc } from "./lib/rpc";
import type { PartnerItem } from "./lib/session";
import { shellLayout } from "./lib/shell-layout";
import { SURFACE } from "./lib/surfaces";
import { zoomOnDoubleClick } from "./lib/zoom";
import { DashboardView } from "./pages/DashboardView";
import { SettingsView } from "./pages/SettingsView";
import { SkillsView } from "./pages/SkillsView";

const escapeLayers: EscapeLayer[] = [
	{ id: "palette", order: ESCAPE_ORDER.palette, isOpen: () => palette.store.getState().open, close: () => palette.close() },
	{ id: "trajectory", order: ESCAPE_ORDER.trajectory, isOpen: () => trajectory.store.getState().open, close: () => trajectory.mutate.setOpen(false) },
	{
		id: "chatlist",
		order: ESCAPE_ORDER.listOverlay,
		isOpen: () => shell.store.getState().listMode === "overlay",
		close: () => shell.dismissListOverlay(),
	},
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

function onOpenPath(path: string, editorId?: string) {
	void rpc.request.open_path({ path, editorId }).then((res) => {
		if (!res.ok) toast.push({ title: "Couldn't open folder", body: res.error ?? "No supported editor found" }, "error");
	});
}

const WELCOME_HEAD = "Say something and it starts.";
let welcomeTyped = false;

const WELCOME_RISE: Variants = {
	hidden: { opacity: 0, y: 6 },
	show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.23, 1, 0.32, 1] } },
};

function WelcomePane(props: { onNewChat: () => void; onOpenSettings: () => void }) {
	const reduceMotion = useReducedMotion();
	const [chars, setChars] = useState(() => (welcomeTyped || reduceMotion ? WELCOME_HEAD.length : 0));
	const typing = chars < WELCOME_HEAD.length;

	useEffect(() => {
		if (reduceMotion) {
			setChars(WELCOME_HEAD.length);
			return;
		}
		if (!typing) {
			welcomeTyped = true;
			return;
		}
		const id = setTimeout(() => setChars((n) => n + 1), chars === 0 ? 220 : 26 + Math.random() * 26);
		return () => clearTimeout(id);
	}, [chars, typing, reduceMotion]);

	return (
		<MotionConfig reducedMotion="user">
			<motion.div className="flex flex-col items-center" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}>
				<motion.h2 variants={WELCOME_RISE} className="m-0 max-w-[26ch] font-serif text-[27px] leading-[1.28] font-medium tracking-[-0.01em] text-balance text-ink">
					<span className="relative inline-block">
						{WELCOME_HEAD.slice(0, chars)}
						<motion.span
							aria-hidden="true"
							className="absolute top-1/2 -right-[5px] h-[0.92em] w-[2px] -translate-y-1/2 bg-muted-soft"
							animate={typing ? { opacity: [1, 1, 0, 0] } : { opacity: 0 }}
							transition={typing ? { duration: 1, times: [0, 0.5, 0.5, 1], repeat: Number.POSITIVE_INFINITY, ease: "linear" } : { duration: 0.3, delay: 0.5 }}
						/>
					</span>
				</motion.h2>
				<motion.p variants={WELCOME_RISE} className="mt-2.5 mb-[18px] max-w-[44ch] text-[13px] text-muted">
					A new chat, or the one you left open. Each keeps its own memory, model and permissions.
				</motion.p>
				<motion.div variants={WELCOME_RISE}>
					<Button variant="primary" class="h-9 rounded-[6px] px-4 text-[13px]" onClick={props.onNewChat}>
						<span>new chat</span>
						<span className="font-mono text-[10px] text-on-ink/70">⌘N</span>
					</Button>
				</motion.div>
				<motion.div variants={WELCOME_RISE} className="mt-[26px] flex flex-col items-center">
					<div className="h-px w-[92px] bg-line" />
					<div className="mt-3 flex flex-col items-start gap-1.5 text-[11.5px]">
						<button type="button" className="flex items-center gap-2 text-muted transition-colors hover:text-ink" onClick={() => palette.launch()}>
							<KbdGroup>
								<Kbd>⌘</Kbd>
								<Kbd>P</Kbd>
							</KbdGroup>
							<span className="border-b border-dotted border-muted-soft pb-px">searches everything</span>
						</button>
						<button type="button" className="flex items-center gap-2 text-muted transition-colors hover:text-ink" onClick={props.onOpenSettings}>
							<KbdGroup>
								<Kbd>⌘</Kbd>
								<Kbd>,</Kbd>
							</KbdGroup>
							<span className="border-b border-dotted border-muted-soft pb-px">settings</span>
						</button>
					</div>
				</motion.div>
			</motion.div>
		</MotionConfig>
	);
}

function ChatView(props: {
	selected: string | null;
	editors: { id: string; name: string }[];
	onViewDetails: (name: string) => void;
	onAddPartner: () => void;
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
	const openTasks = useCallback(() => setTaskOpen(true), []);
	const taskVersion = useStore(tasksCtl.store, (state) => state.version);
	const taskOutput = useStore(tasksCtl.store, (state) => state.output);
	const taskList = useStore(tasksCtl.store, (state) => state.tasks);
	const listWidth = useStore(dock.store, (state) => state.listWidth);
	const listOpen = useStore(dock.store, (state) => state.listOpen);
	const listPref = useStore(shell.store, (state) => state.listOpen);
	const listOverride = useStore(shell.store, (state) => state.listOverride);
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
		const observer = new ResizeObserver(() => {
			setRowWidth(el.clientWidth);
			shell.setRow(el.clientWidth);
		});
		observer.observe(el);
		rowObserver.current = observer;
		setRowWidth(el.clientWidth);
		shell.setRow(el.clientWidth);
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

	/* 三个区的宽度规则都在 shellLayout 里（一处分级）：信纸是主人，列表和 dock 是客人 ——
	   装不下就离场，谁都不许把信纸夹窄。见 lib/shell-layout.ts。 */
	const layout = shellLayout({ row: rowWidth, listWidth, listOpen: listPref, listOverride, dockOpen: docked, dockWidth });
	const listMode = layout.list.mode;
	const dockMode = layout.dock.mode;
	const listWidthNow = layout.list.width;
	const dockWidthNow = layout.dock.width;
	const listInFlow = listMode === "flow";
	const dockInFlow = dockMode === "flow";
	/* 信纸的宽就是这一行的余量：在流里的列扣掉，浮层一点都不扣 —— 不用谁去钉它 */
	const listColumn = listInFlow ? listWidthNow + GRIP_WIDTH : 0;
	const dockColumn = dockInFlow ? dockWidthNow + GRIP_WIDTH : 0;

	/* 拖动上限 = 邻居让到底（它的最小宽）、信纸保住地板时还能给多少。
	   上限不低于当前值 —— 否则在窄窗口里一按下鼠标就会「啪」地缩一下。 */
	const listMax = Math.max(
		LIST_MIN,
		listWidthNow,
		rowWidth === 0 ? LIST_MAX : Math.min(LIST_MAX, rowWidth - GRIP_WIDTH - (dockInFlow ? DOCK_MIN + GRIP_WIDTH : 0) - WORKBENCH_MIN),
	);
	const dockMax = Math.max(DOCK_MIN, dockWidthNow, rowWidth === 0 ? dockWidthNow : rowWidth - GRIP_WIDTH - (listInFlow ? LIST_MIN + GRIP_WIDTH : 0) - WORKBENCH_MIN);
	const workbenchSpace = Math.max(0, rowWidth - listColumn - dockColumn);

	/* 拖动时上方那串数字：就是拿拖动中的值再过一遍 shellLayout —— 读数不会和规则分家。
	   三栏全开是 `sidebar / workbench / dock`，两栏就是两个数。 */
	function splitReadout(dragged: "list" | "dock", width: number): string {
		const laid = shellLayout({
			row: rowWidth,
			listWidth: dragged === "list" ? width : listWidth,
			listOpen: listPref,
			listOverride,
			dockOpen: docked,
			dockWidth: dragged === "dock" ? width : dockWidth,
		});
		const parts: number[] = [];
		if (laid.list.mode === "flow") parts.push(laid.list.width);
		parts.push(laid.workbench);
		if (laid.dock.mode === "flow") parts.push(laid.dock.width);
		return parts.map((value) => Math.round(value)).join(" / ");
	}

	/* 形态给外壳读一次（macOS 那块玻璃跟不跟画布走）—— 在着色前写，免得角落闪一帧 */
	useLayoutEffect(() => {
		shell.publishListMode(listMode);
	});

	/* 一列从「在流里」被窗口挤出来，就直接关掉：浮层只能由用户当场打开，没有「窗口把我挤成浮层」这回事。
	   在 layout effect 里做，所以那一帧的浮层还没着色就被换掉了。 */
	const prevModes = useRef({ list: listMode, dock: dockMode });
	useLayoutEffect(() => {
		const prev = prevModes.current;
		prevModes.current = { list: listMode, dock: dockMode };
		if (prev.dock === "flow" && dockMode === "overlay") dock.close();
		if (prev.list === "flow" && listMode === "overlay") shell.dismissListOverlay();
	});

	return (
		<div className="chat-page" ref={bindRow}>
			<div
				className={"conv-pane" + (listInFlow ? "" : listMode === "overlay" ? " floating" : " collapsed")}
				style={listInFlow || listMode === "overlay" ? { width: listWidthNow } : undefined}
				inert={listMode === "collapsed"}
			>
				<AppSidebar
					partners={partners}
					loading={partnersLoading}
					selected={selected}
					unread={isUnread}
					onSelect={(name) => {
						if (listMode !== "flow") shell.dismissListOverlay();
						selectPartner(partners.find((p) => p.name === name) ?? null);
					}}
					onAddPartner={props.onAddPartner}
					onDelete={(name) => void onDeletePartner(name)}
					onViewDetails={props.onViewDetails}
					onDuplicate={(name) => void runCopy("duplicate", name)}
					onFork={(name) => void runCopy("fork", name)}
					onPromote={(name) => void onPromotePartner(name)}
					onToggleList={shell.toggleList}
					onOpenSettings={props.onOpenSettings}
				/>
			</div>
			{listInFlow && (
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
					listInFlow={listInFlow}
					listShown={listMode !== "collapsed"}
					onToggleList={shell.toggleList}
				/>
				<div className="chat-row">
					{selected ? (
						<div className={"chat-body" + (btwAnchor ? " btw-open" : "")}>
							<Workbench
								worker={selected}
								working={busy}
								historyLoading={loading}
								activeBtwAnchor={btwAnchor}
								onBtwAnchor={setBtwAnchor}
								tasks={taskList}
								taskVersion={taskVersion}
								taskOutput={taskOutput}
								taskOpen={taskOpen}
								onTaskOpenChange={setTaskOpen}
								onTaskOpen={openTasks}
							/>
						</div>
					) : (
						<div className="chat-main">
							<div className="flex flex-1 flex-col items-center justify-center px-14 text-center" ref={emptyWindow}>
								<WelcomePane onNewChat={props.onAddPartner} onOpenSettings={props.onOpenSettings} />
							</div>
						</div>
					)}
					{dockInFlow && (
						<DockGrip
							class="dock-grip-edge"
							width={() => dockWidthNow}
							min={DOCK_MIN}
							max={dockMax}
							side="right"
							label="Resize the dock"
							half={() => Math.round((workbenchSpace + dockColumn) / 2)}
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
								mode={dockMode === "overlay" ? "overlay" : "flow"}
								pane={layout.dock.pane}
								width={dockMode === "closed" ? 0 : dockWidthNow}
								paneWidth={paneWidth}
								listOpen={listOpen}
								onToggleList={dock.toggleListOpen}
								wrap={wrap}
								onToggleWrap={dock.toggleWrap}
							/>
							<GitChangesDrawer
								open={panel === "git"}
								partner={selected}
								mode={dockMode === "overlay" ? "overlay" : "flow"}
								pane={layout.dock.pane}
								width={dockMode === "closed" ? 0 : dockWidthNow}
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
	const [showModal, setShowModal] = useState(false);
	const [detailsPartner, setDetailsPartner] = useState<PartnerItem | null>(null);

	const selected = useStore(session.store, (state) => state.selected);
	const partners = useStore(session.store, (state) => state.partners);
	const readAt = useStore(unread.store, (state) => state.readAt);
	const agentSnapshot = useStore(status.store, (state) => state.snapshot);
	const toasts = useStore(toast.store, (state) => state.toasts);
	const settingsOpen = useStore(settings.store, (state) => state.open);
	const settingsSnapshot = useStore(settings.store, (state) => state.snapshot);
	const listMode = useStore(shell.store, (state) => state.listMode);
	const listCollapsed = listMode !== "flow";
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

	const toggleList = shell.toggleList;

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
		if (action === "milu.view-chat" || action === "milu.view-skills" || action === "milu.view-dashboard") {
			setView(action.slice("milu.view-".length) as ViewId);
			return;
		}
		if (action === "milu.settings") {
			settings.mutate.setOpen(true);
			return;
		}
		if (action === "milu.palette" || action === "milu.access") {
			palette.launch(action === "milu.palette" ? "sessions" : "access");
			return;
		}
		setView("chat");
		switch (action) {
			case "milu.new-partner":
				openAddPartner();
				return;
			case "milu.details":
				if (selected) openDetails(selected);
				return;
			case "milu.close-chat":
				closeCurrentChat();
				return;
			case "milu.trajectory":
				trajectory.mutate.setOpen(true);
				return;
			case "milu.replies":
				dock.open("replies");
				return;
			case "milu.workspace":
				dock.open("explorer");
				return;
			case "milu.git-changes":
				dock.open("git");
				return;
			case "milu.toggle-list":
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
																					onOpenSettings={() => settings.mutate.setOpen(true)}
																				/>
																			)}
																			<ToastHost toasts={toasts} placement={settingsSnapshot.settings?.toastPlacement ?? "bottomcenter"} onDismiss={toast.dismiss} />
																		</main>
																	</div>
																</div>
																<Dialog open={settingsOpen} onOpenChange={settings.mutate.setOpen}>
																	<DialogContent
																		size={{ w: 820, h: 640 }}
																		className="grid-rows-[auto_1fr] overflow-hidden bg-surface border-print-line p-0"
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
