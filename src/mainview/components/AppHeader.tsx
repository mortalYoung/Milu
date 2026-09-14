import { Activity, Folder, GitBranch, ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-solid";
import { Show } from "solid-js";
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
	const panel = () => props.dock.panel();
	const dockSide = () => settings.data()?.settings?.dockSide ?? "right";
	const hasConversation = () => props.selected != null && transcript.view().length > 0;
	const hasWorkspace = () => status.data().workspace_path != null;
	const gitAvailable = () => hasWorkspace() && status.data().is_git_repo;
	const hasDockTools = () => hasWorkspace() || gitAvailable();

	const explorerButton = () => (
		<Show when={hasWorkspace()}>
			<button type="button" class={headerIconClass} title="Explorer" aria-label="Toggle explorer" onClick={() => props.dock.toggle("explorer")}>
				<Folder size={16} />
			</button>
		</Show>
	);
	const gitButton = () => (
		<Show when={gitAvailable()}>
			<button type="button" class={headerIconClass} title="Git Changes" aria-label="Toggle git changes" onClick={() => props.dock.toggle("git")}>
				<GitBranch size={16} />
			</button>
		</Show>
	);

	const worktreesButton = () => (
		<Show when={gitAvailable()}>
			<WorktreeMenu
				partner={props.selected}
				buttonClass={headerIconClass}
				onSwitch={() => {
					const panel = props.dock.panel();
					if (panel === "explorer" || panel === "git") props.dock.close();
				}}
			/>
		</Show>
	);

	const onDoubleClick = (event: MouseEvent) => {
		if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [contenteditable='true']")) return;
		void rpc.request.window_zoom_toggle({});
	};

	return (
		<div class="chat-header electrobun-webkit-app-region-drag" onDblClick={onDoubleClick}>
			<Button
				variant="ghost"
				size="icon"
				class="chat-toggle size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag"
				title={props.listCollapsed ? "Show chat list" : "Hide chat list"}
				icon={props.listCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
				onClick={props.onToggleList}
			/>
			<Show when={dockSide() === "left"}>
				<div class="chat-tools-left">
					<Show when={hasDockTools()}>
						<span class="chat-tools-sep" />
					</Show>
					{explorerButton()}
					{gitButton()}
					{worktreesButton()}
				</div>
			</Show>
			<div class="chat-worker electrobun-webkit-app-region-no-drag cursor-pointer" title="View details" onClick={() => props.selected && props.onViewDetails(props.selected)}>
				<span>{props.selected ?? "Chat"}</span>
				{status.isBusyForSelected() && (
					<span class="chat-worker-status" title="Working…">
						<span class="work-dot" />
						<span class="work-dot" />
						<span class="work-dot" />
						Writing…
					</span>
				)}
			</div>

			<div class="btn-group">
				<Show when={dockSide() === "right"}>
					{explorerButton()}
					{gitButton()}
					{worktreesButton()}
					<Show when={hasDockTools()}>
						<span class="chat-tools-sep" />
					</Show>
				</Show>
				<button
					type="button"
					class={headerIconClass}
					title={panel() === "replies" ? "Hide replies" : "Show replies"}
					aria-label="Toggle replies"
					disabled={!hasConversation()}
					onClick={() => props.dock.toggle("replies")}
				>
					<ListTree size={16} />
				</button>

				<button
					type="button"
					class={headerIconClass}
					title={trajectory.data.open() ? "Close trajectory" : "Open trajectory"}
					aria-label="Toggle trajectory"
					disabled={!hasConversation()}
					onClick={() => {
						if (!trajectory.data.open()) props.dock.close();
						trajectory.mutate.toggle();
					}}
				>
					<Activity size={16} />
				</button>
			</div>
		</div>
	);
}
