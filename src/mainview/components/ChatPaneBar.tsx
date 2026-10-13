import { Activity, Folder, GitBranch, ListTree, PanelLeftOpen } from "lucide-react";
import { useStore } from "zustand";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import type { Dock } from "../lib/dock";
import { zoomOnDoubleClick } from "../lib/zoom";
import { Tip } from "./ui/tooltip";
import { WorktreeMenu } from "./WorktreeMenu";

const barIconClass =
	"size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function ChatPaneBar(props: {
	dock: Dock;
	selected: string | null;
	onViewDetails: (name: string) => void;
	/** 列表在流里（占着左边那一列）；不在流里时条从窗口边起，给红绿灯留出角 */
	listInFlow: boolean;
	/** 列表此刻看得见（在流里或浮层）；看不见时条左边给它一个回来的按钮 */
	listShown: boolean;
	onToggleList: () => void;
}) {
	const status = useAgentStatus();
	const trajectory = useTrajectory();
	const transcript = useTranscript();

	const snapshot = useStore(status.store, (state) => state.snapshot);
	const dockPanels = useStore(props.dock.store, (state) => state.panels);
	const trajectoryOpen = useStore(trajectory.store, (state) => state.open);
	const itemCount = useStore(transcript.store, (state) => state.items.length);

	const panel = props.selected ? (dockPanels[props.selected] ?? null) : null;
	const hasConversation = props.selected != null && itemCount > 0;
	const hasWorkspace = snapshot.workspace_path != null;
	const gitAvailable = hasWorkspace && snapshot.is_git_repo;
	const hasChanges = gitAvailable && snapshot.change_count > 0;
	const hasWorktrees = gitAvailable && snapshot.worktree_count > 1;
	const changeCount = snapshot.change_count;
	const changeLabel = `${changeCount} change${changeCount === 1 ? "" : "s"}`;
	const changeBadge = changeCount > 99 ? "99+" : String(changeCount);
	const hasDockTools = hasWorkspace || gitAvailable;
	const isOpen = (which: "explorer" | "git" | "replies") => panel === which;

	const explorerButton = hasWorkspace ? (
		<Tip label="Explorer">
			<button
				type="button"
				className={barIconClass + (isOpen("explorer") ? " on" : "")}
				aria-pressed={isOpen("explorer")}
				aria-label="Toggle explorer"
				onClick={() => props.dock.toggle("explorer")}
			>
				<Folder size={16} />
			</button>
		</Tip>
	) : null;

	const gitButton = hasChanges ? (
		<Tip label={`Git Changes · ${changeLabel}`}>
			<button
				type="button"
				className={barIconClass + " relative" + (isOpen("git") ? " on" : "")}
				aria-pressed={isOpen("git")}
				aria-label={`Toggle git changes, ${changeLabel}`}
				onClick={() => props.dock.toggle("git")}
			>
				<GitBranch size={16} />
				<span className="header-badge">{changeBadge}</span>
			</button>
		</Tip>
	) : null;

	const worktreesButton = hasWorktrees ? (
		<WorktreeMenu
			partner={props.selected}
			buttonClass={barIconClass}
			onSwitch={() => {
				const current = props.selected ? (props.dock.store.getState().panels[props.selected] ?? null) : null;
				if (current === "explorer" || current === "git") props.dock.close();
			}}
		/>
	) : null;

	const dockTools = (
		<>
			{explorerButton}
			{gitButton}
			{worktreesButton}
			{hasDockTools && <span className="chat-tools-sep" />}
		</>
	);

	return (
		<div className={"chat-bar electrobun-webkit-app-region-drag" + (props.listInFlow ? "" : " at-edge")} onDoubleClick={zoomOnDoubleClick}>
			<div className="chat-bar-lead">
				{!props.listShown && (
					<Tip label="Show chat list (⌘B)">
						<button type="button" className={barIconClass + " list-expand"} aria-label="Show chat list" onClick={props.onToggleList}>
							<PanelLeftOpen size={16} />
						</button>
					</Tip>
				)}
			</div>

			<Tip label="View details">
				<button
					type="button"
					className="chat-bar-name p-0 text-left"
					aria-label={props.selected ? `${props.selected} — view details` : "View details"}
					onClick={() => props.selected && props.onViewDetails(props.selected)}
				>
					<span>{props.selected ?? "Chat"}</span>
					{status.isBusyForSelected() && (
						<span className="chat-bar-status">
							<span className="work-dot" />
							<span className="work-dot" />
							<span className="work-dot" />
							Writing…
						</span>
					)}
				</button>
			</Tip>

			<div className="chat-bar-tools">
				{dockTools}
				<Tip label={panel === "replies" ? "Hide replies" : "Show replies"}>
					<button
						type="button"
						aria-label={panel === "replies" ? "Hide replies" : "Show replies"}
						className={barIconClass + (isOpen("replies") ? " on" : "")}
						aria-pressed={isOpen("replies")}
						disabled={!hasConversation}
						onClick={() => props.dock.toggle("replies")}
					>
						<ListTree size={16} />
					</button>
				</Tip>

				<Tip label={trajectoryOpen ? "Close trajectory" : "Open trajectory"}>
					<button
						type="button"
						aria-label={trajectoryOpen ? "Close trajectory" : "Open trajectory"}
						className={barIconClass + (trajectoryOpen ? " on" : "")}
						aria-pressed={trajectoryOpen}
						disabled={!hasConversation}
						onClick={() => {
							if (!trajectoryOpen) props.dock.close();
							trajectory.mutate.toggle();
						}}
					>
						<Activity size={16} />
					</button>
				</Tip>
			</div>
		</div>
	);
}
