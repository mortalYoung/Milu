import { Activity, Folder, GitBranch, ListTree, PanelLeftOpen } from "lucide-react";
import { useStore } from "zustand";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useSettings } from "../lib/contexts/settings-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import type { Dock } from "../lib/dock";
import { zoomOnDoubleClick } from "../lib/zoom";
import { WorktreeMenu } from "./WorktreeMenu";

const barIconClass =
	"size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function ChatPaneBar(props: { dock: Dock; selected: string | null; onViewDetails: (name: string) => void; listCollapsed: boolean; onToggleList: () => void }) {
	const status = useAgentStatus();
	const settings = useSettings();
	const trajectory = useTrajectory();
	const transcript = useTranscript();

	const snapshot = useStore(status.store, (state) => state.snapshot);
	const dockPanels = useStore(props.dock.store, (state) => state.panels);
	const settingsSnapshot = useStore(settings.store, (state) => state.snapshot);
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
	const dockSide = settingsSnapshot.settings?.dockSide ?? "right";

	const explorerButton = hasWorkspace ? (
		<button
			type="button"
			className={barIconClass + (isOpen("explorer") ? " on" : "")}
			aria-pressed={isOpen("explorer")}
			title="Explorer"
			aria-label="Toggle explorer"
			onClick={() => props.dock.toggle("explorer")}
		>
			<Folder size={16} />
		</button>
	) : null;

	const gitButton = hasChanges ? (
		<button
			type="button"
			className={barIconClass + " relative" + (isOpen("git") ? " on" : "")}
			aria-pressed={isOpen("git")}
			title={`Git Changes · ${changeLabel}`}
			aria-label={`Toggle git changes, ${changeLabel}`}
			onClick={() => props.dock.toggle("git")}
		>
			<GitBranch size={16} />
			<span className="header-badge">{changeBadge}</span>
		</button>
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
			{dockSide === "left" && hasDockTools && <span className="chat-tools-sep" />}
			{explorerButton}
			{gitButton}
			{worktreesButton}
			{dockSide === "right" && hasDockTools && <span className="chat-tools-sep" />}
		</>
	);

	return (
		<div className={"chat-bar electrobun-webkit-app-region-drag" + (props.listCollapsed ? " at-edge" : "")} onDoubleClick={zoomOnDoubleClick}>
			<div className="chat-bar-lead">
				{props.listCollapsed && (
					<button type="button" className={barIconClass} title="Show chat list (⌘B)" aria-label="Show chat list" onClick={props.onToggleList}>
						<PanelLeftOpen size={16} />
					</button>
				)}
				{dockSide === "left" && dockTools}
			</div>

			<div className="chat-bar-name" title="View details" onClick={() => props.selected && props.onViewDetails(props.selected)}>
				<span>{props.selected ?? "Chat"}</span>
				{status.isBusyForSelected() && (
					<span className="chat-bar-status" title="Working…">
						<span className="work-dot" />
						<span className="work-dot" />
						<span className="work-dot" />
						Writing…
					</span>
				)}
			</div>

			<div className="chat-bar-tools">
				{dockSide === "right" && dockTools}
				<button
					type="button"
					className={barIconClass + (isOpen("replies") ? " on" : "")}
					aria-pressed={isOpen("replies")}
					title={panel === "replies" ? "Hide replies" : "Show replies"}
					aria-label="Toggle replies"
					disabled={!hasConversation}
					onClick={() => props.dock.toggle("replies")}
				>
					<ListTree size={16} />
				</button>

				<button
					type="button"
					className={barIconClass + (trajectoryOpen ? " on" : "")}
					aria-pressed={trajectoryOpen}
					title={trajectoryOpen ? "Close trajectory" : "Open trajectory"}
					aria-label="Toggle trajectory"
					disabled={!hasConversation}
					onClick={() => {
						if (!trajectoryOpen) props.dock.close();
						trajectory.mutate.toggle();
					}}
				>
					<Activity size={16} />
				</button>
			</div>
		</div>
	);
}
