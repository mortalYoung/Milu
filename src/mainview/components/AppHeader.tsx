import { Activity, Folder, GitBranch, ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useStore } from "zustand";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useSettings } from "../lib/contexts/settings-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import type { Dock } from "../lib/dock";
import { rpc } from "../lib/rpc";
import { Button } from "./Button";
import { WorktreeMenu } from "./WorktreeMenu";

const headerIconClass =
	"size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-paper-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

export function AppHeader(props: { dock: Dock; selected: string | null; onViewDetails: (name: string) => void; listCollapsed: boolean; onToggleList: () => void }) {
	const status = useAgentStatus();
	const settings = useSettings();
	const trajectory = useTrajectory();
	const transcript = useTranscript();

	const snapshot = useStore(status.store, (state) => state.snapshot);
	const dockPanels = useStore(props.dock.store, (state) => state.panels);
	const trajectoryOpen = useStore(trajectory.store, (state) => state.open);
	const settingsSnapshot = useStore(settings.store, (state) => state.snapshot);
	const itemCount = useStore(transcript.store, (state) => state.items.length);

	const panel = props.selected ? (dockPanels[props.selected] ?? null) : null;
	const dockSide = settingsSnapshot.settings?.dockSide ?? "right";
	const hasConversation = props.selected != null && itemCount > 0;
	const hasWorkspace = snapshot.workspace_path != null;
	const gitAvailable = hasWorkspace && snapshot.is_git_repo;
	const hasChanges = gitAvailable && snapshot.change_count > 0;
	const hasWorktrees = gitAvailable && snapshot.worktree_count > 1;
	const changeCount = snapshot.change_count;
	const changeLabel = `${changeCount} change${changeCount === 1 ? "" : "s"}`;
	const changeBadge = changeCount > 99 ? "99+" : String(changeCount);
	const hasDockTools = hasWorkspace || gitAvailable;

	const explorerButton = hasWorkspace ? (
		<button type="button" className={headerIconClass} title="Explorer" aria-label="Toggle explorer" onClick={() => props.dock.toggle("explorer")}>
			<Folder size={16} />
		</button>
	) : null;

	const gitButton = hasChanges ? (
		<button
			type="button"
			className={headerIconClass + " relative"}
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
			buttonClass={headerIconClass}
			onSwitch={() => {
				const current = props.selected ? (props.dock.store.getState().panels[props.selected] ?? null) : null;
				if (current === "explorer" || current === "git") props.dock.close();
			}}
		/>
	) : null;

	const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [contenteditable='true']")) return;
		void rpc.request.window_zoom_toggle({});
	};

	return (
		<div className="chat-header electrobun-webkit-app-region-drag" onDoubleClick={onDoubleClick}>
			<Button
				variant="ghost"
				size="icon"
				class="chat-toggle size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag"
				title={props.listCollapsed ? "Show chat list" : "Hide chat list"}
				icon={props.listCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
				onClick={props.onToggleList}
			/>
			{dockSide === "left" && (
				<div className="chat-tools-left">
					{hasDockTools && <span className="chat-tools-sep" />}
					{explorerButton}
					{gitButton}
					{worktreesButton}
				</div>
			)}
			<div className="chat-worker electrobun-webkit-app-region-no-drag cursor-pointer" title="View details" onClick={() => props.selected && props.onViewDetails(props.selected)}>
				<span>{props.selected ?? "Chat"}</span>
				{status.isBusyForSelected() && (
					<span className="chat-worker-status" title="Working…">
						<span className="work-dot" />
						<span className="work-dot" />
						<span className="work-dot" />
						Writing…
					</span>
				)}
			</div>

			<div className="btn-group">
				{dockSide === "right" && (
					<>
						{explorerButton}
						{gitButton}
						{worktreesButton}
						{hasDockTools && <span className="chat-tools-sep" />}
					</>
				)}
				<button
					type="button"
					className={headerIconClass}
					title={panel === "replies" ? "Hide replies" : "Show replies"}
					aria-label="Toggle replies"
					disabled={!hasConversation}
					onClick={() => props.dock.toggle("replies")}
				>
					<ListTree size={16} />
				</button>

				<button
					type="button"
					className={headerIconClass}
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
