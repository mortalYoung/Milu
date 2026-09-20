import { type Accessor, createEffect, createSignal, type JSX, onCleanup } from "solid-js";
import { AnimatePresence, Motion } from "solid-motion";
import type { TaskSummary } from "../../shared/rpc";
import { Composer } from "../components/Composer";
import { ConversationList, type PartnerItem } from "../components/ConversationList";
import { ExplorerDrawer } from "../components/ExplorerDrawer";
import { GitChangesDrawer } from "../components/GitChangesDrawer";
import { RepliesPane } from "../components/RepliesPane";
import { TaskLogDialog } from "../components/TaskLogDialog";
import { Transcript } from "../layouts/Transcript";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useSettings } from "../lib/contexts/settings-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import type { Dock } from "../lib/dock";
import { rpc } from "../lib/rpc";

export function ConversationPage(props: {
	dock: Dock;
	partners: PartnerItem[];
	selected: string | null;
	onSelect: (name: string) => void;
	onAddPartner: () => void;
	onDelete: (name: string) => void;
	onViewDetails: (name: string) => void;
	onDuplicate: (name: string) => void;
	onFork: (name: string) => void;
	onPromote: (name: string) => void;
	listCollapsed: boolean;

	historyLoading: Accessor<boolean>;
	onSend: (text: string) => void;
	onStop: () => void;

	onEscalationRespond: (id: string, approved: boolean) => void;

	unread: (name: string) => boolean;

	toastHost?: JSX.Element;
	onShell?: (command: string) => Promise<{ ok: boolean; error?: string; shellId?: string }>;
	onOpenPath?: (path: string, editorId?: string) => void;
	editors?: { id: string; name: string }[];
}) {
	const status = useAgentStatus();
	const settings = useSettings();
	const trajectory = useTrajectory();
	const transcript = useTranscript();
	const panel = () => props.dock.panel();
	const [btwOpen, setBtwOpen] = createSignal(false);
	const [btwAnchor, setBtwAnchor] = createSignal<string | null>(null);
	const [taskOpen, setTaskOpen] = createSignal(false);
	const [taskVersion, setTaskVersion] = createSignal(0);
	const [taskOutput, setTaskOutput] = createSignal(0);
	const [tasks, setTasks] = createSignal<TaskSummary[]>([]);
	rpc.addMessageListener("task_update", ({ kind }) => {
		if (kind === "output") setTaskOutput((v) => v + 1);
		else setTaskVersion((v) => v + 1);
	});
	createEffect(() => {
		const name = props.selected;
		taskVersion();
		if (!name) {
			setTasks([]);
			return;
		}
		void rpc.request.task_list({ name }).then((response) => setTasks(response.tasks));
	});
	// The unpinned dock stops above the composer instead of covering it, so it needs that height.
	const [composerHeight, setComposerHeight] = createSignal(0);
	let composerObserver: ResizeObserver | undefined;
	function bindComposerSlot(el: HTMLDivElement) {
		composerObserver?.disconnect();
		composerObserver = new ResizeObserver(() => setComposerHeight(el.clientHeight));
		composerObserver.observe(el);
		setComposerHeight(el.clientHeight);
	}
	onCleanup(() => composerObserver?.disconnect());
	const workspacePath = () => status.data().workspace_path;
	const hasWorkspace = () => workspacePath() != null;
	const gitAvailable = () => hasWorkspace() && status.data().is_git_repo;
	// Both conditions describe the selected partner, so they may only act on that partner's status: the
	// stale one in hand right after a switch would close the dock this partner had open.
	createEffect(() => {
		if (!status.settled()) return;
		if (!hasWorkspace() && panel() === "explorer") props.dock.close();
	});
	createEffect(() => {
		if (!status.settled()) return;
		if ((!gitAvailable() || status.data().change_count === 0) && panel() === "git") props.dock.close();
	});

	const hasConversation = () => props.selected != null && transcript.view().length > 0;
	const dockSide = () => settings.data()?.settings?.dockSide ?? "right";
	// No partner, no dock to close: which panel is open is each partner's own state, so leaving the
	// partner leaves it behind for the partner it belongs to. Switching partners, in particular,
	// empties the transcript for a beat while its history loads — that is not a reason to close.
	createEffect(() => {
		if (!hasConversation()) {
			setBtwOpen(false);
			setBtwAnchor(null);
			trajectory.mutate.setOpen(false);
		}
	});

	return (
		<div class="chat-page">
			<AnimatePresence>
				{!props.listCollapsed && (
					<Motion as="div" class="shrink-0 h-full" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
						<ConversationList
							partners={props.partners}
							selected={props.selected}
							unread={props.unread}
							onSelect={props.onSelect}
							onAddPartner={props.onAddPartner}
							onDelete={props.onDelete}
							onViewDetails={props.onViewDetails}
							onDuplicate={props.onDuplicate}
							onFork={props.onFork}
							onPromote={props.onPromote}
						/>
					</Motion>
				)}
			</AnimatePresence>

			<div class="chat-window">
				{props.selected ? (
					<div class="chat-body" classList={{ "btw-open": btwOpen() }}>
						<div
							class="chat-main"
							classList={{ pinned: props.dock.pinned(props.selected, panel()), "side-left": dockSide() === "left" }}
							style={{ "--dock-bottom": `${composerHeight()}px`, ...(props.dock.letterWidth() != null ? { "--letter-width": `${props.dock.letterWidth()}px` } : {}) }}
						>
							<div class="chat-letter">
								<div class="chat-transcript-region">
									<Transcript
										working={status.isBusyForSelected}
										historyLoading={props.historyLoading}
										worker={props.selected}
										onEscalationRespond={props.onEscalationRespond}
										onBtw={(anchor) => {
											setBtwAnchor(anchor);
											setBtwOpen(true);
										}}
										onBtwClose={() => {
											setBtwAnchor(null);
											setBtwOpen(false);
										}}
										activeBtwAnchor={btwOpen() ? btwAnchor() : null}
									/>
								</div>
								<div class="composer-slot" ref={bindComposerSlot}>
									<Composer
										onSend={props.onSend}
										onStop={props.onStop}
										onShell={props.onShell}
										onOpenPath={props.onOpenPath}
										onTasks={() => setTaskOpen(true)}
										hasTasks={tasks().length > 0}
										taskRunning={tasks().filter((task) => task.status === "running").length}
										editors={props.editors}
									/>
									<TaskLogDialog open={taskOpen()} onOpenChange={setTaskOpen} tasks={tasks()} partner={props.selected} version={taskVersion()} output={taskOutput()} />
								</div>
							</div>
							<ExplorerDrawer
								open={panel() === "explorer"}
								partner={props.selected}
								reveal={props.dock.reveal()}
								side={dockSide()}
								pinned={props.dock.pinned(props.selected, "explorer")}
								onTogglePin={() => props.dock.togglePinned(props.selected, "explorer")}
								letterWidth={props.dock.letterWidth()}
								setLetterWidth={props.dock.setLetterWidth}
								commitLetterWidth={props.dock.commitLetterWidth}
								paneWidth={props.dock.paneWidth()}
								onPaneResize={props.dock.setPaneWidth}
								onPaneCommit={props.dock.commitPaneWidth}
								wrap={props.dock.wrap()}
								onToggleWrap={props.dock.toggleWrap}
								onClose={() => props.dock.close()}
							/>
							<GitChangesDrawer
								open={panel() === "git"}
								partner={props.selected}
								side={dockSide()}
								pinned={props.dock.pinned(props.selected, "git")}
								onTogglePin={() => props.dock.togglePinned(props.selected, "git")}
								letterWidth={props.dock.letterWidth()}
								setLetterWidth={props.dock.setLetterWidth}
								commitLetterWidth={props.dock.commitLetterWidth}
								paneWidth={props.dock.paneWidth()}
								onPaneResize={props.dock.setPaneWidth}
								onPaneCommit={props.dock.commitPaneWidth}
								sideBySide={props.dock.sideBySide()}
								onToggleSideBySide={props.dock.toggleSideBySide}
								wrap={props.dock.wrap()}
								onToggleWrap={props.dock.toggleWrap}
								onClose={() => props.dock.close()}
							/>
						</div>
					</div>
				) : (
					<div class="flex-1 flex flex-col items-center justify-center gap-3 text-center">
						<p class="font-serif text-[17px] text-ink-soft">— select a partner to begin —</p>
						<p class="eyebrow">the directory is on the left</p>
					</div>
				)}
				{props.toastHost}
			</div>

			<RepliesPane open={panel() === "replies"} />
		</div>
	);
}
