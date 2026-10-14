import { Activity, AlarmClock, Folder, GitBranch, ListTree, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ScheduleItem, ScheduleRunItem } from "../../shared/rpc";
import { convTime } from "../lib/chat-preview";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import type { Dock } from "../lib/dock";
import { rpc } from "../lib/rpc";
import { zoomOnDoubleClick } from "../lib/zoom";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
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
	const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
	const [scheduleRuns, setScheduleRuns] = useState<ScheduleRunItem[]>([]);
	const [schedulesOpen, setSchedulesOpen] = useState(false);
	const selectedRef = useRef(props.selected);
	selectedRef.current = props.selected;

	const loadSchedules = useCallback(() => {
		const name = props.selected;
		if (!name) {
			setScheduleItems([]);
			setScheduleRuns([]);
			return;
		}
		void rpc.request.schedule_list({ name }).then((res) => {
			if (name !== selectedRef.current) return;
			setScheduleItems(res.items);
			setScheduleRuns(res.history);
		});
	}, [props.selected]);

	useEffect(() => {
		loadSchedules();
		const onScheduleUpdate = ({ partner }: { partner: string }) => {
			if (partner === props.selected) loadSchedules();
		};
		const onRunEnd = ({ partner }: { partner: string }) => {
			if (partner === props.selected) loadSchedules();
		};
		rpc.addMessageListener("schedule_update", onScheduleUpdate);
		rpc.addMessageListener("agent_end", onRunEnd);
		return () => {
			rpc.removeMessageListener("schedule_update", onScheduleUpdate);
			rpc.removeMessageListener("agent_end", onRunEnd);
		};
	}, [loadSchedules, props.selected]);

	const panel = props.selected ? (dockPanels[props.selected] ?? null) : null;
	const hasConversation = props.selected != null && itemCount > 0;
	const hasWorkspace = snapshot.workspace_path != null;
	const gitAvailable = hasWorkspace && snapshot.is_git_repo;
	const hasChanges = gitAvailable && snapshot.change_count > 0;
	const hasWorktrees = gitAvailable && snapshot.worktree_count > 1;
	const upcoming = scheduleItems
		.filter((item) => item.status === "active")
		.map((item) => item.retryAt ?? item.nextRunAt)
		.filter((value): value is number => value != null)
		.sort((a, b) => a - b)[0];
	const scheduleCount = scheduleItems.length;
	const scheduleLabel = `${scheduleCount} scheduled task${scheduleCount === 1 ? "" : "s"}${upcoming != null ? ` · next ${convTime(upcoming)}` : ""}`;
	const scheduleRows = [...scheduleItems]
		.map((item) => {
			const runs = scheduleRuns.filter((record) => record.scheduleId === item.id && record.status !== "dispatched");
			const last = runs[0];
			const at = item.status === "active" ? (item.retryAt ?? item.nextRunAt) : null;
			const facts = [
				item.retryAt != null && at != null ? `retrying ${convTime(at)}` : at != null ? `next ${convTime(at)}` : item.status,
				last ? `last ${last.status}` : null,
				`${item.runCount} runs`,
				...(last?.error ? [last.error] : []),
			].filter((value): value is string => Boolean(value));
			return { item, last, facts };
		})
		.sort(
			(a, b) =>
				(a.item.status === "active" ? 0 : 1) - (b.item.status === "active" ? 0 : 1) || (a.item.retryAt ?? a.item.nextRunAt ?? 0) - (b.item.retryAt ?? b.item.nextRunAt ?? 0),
		);
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

			<div className="chat-bar-name">
				<Tip label="View details">
					<button
						type="button"
						className="chat-bar-name-text"
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
				{scheduleCount > 0 && props.selected ? (
					<Popover
						open={schedulesOpen}
						onOpenChange={(next) => {
							setSchedulesOpen(next);
							if (next) loadSchedules();
						}}
					>
						<PopoverTrigger asChild>
							<button type="button" className="chat-bar-sched electrobun-webkit-app-region-no-drag" aria-label={`${scheduleLabel} — show schedules`} aria-expanded={schedulesOpen}>
								<AlarmClock size={11} />
								{scheduleCount}
							</button>
						</PopoverTrigger>
						<PopoverContent align="center" className="p-0">
							<div className="sched-pop">
								<div className="sched-pop-head">
									<span className="sched-pop-eyebrow">Scheduled</span>
									<span className="sched-pop-summary">{scheduleLabel}</span>
								</div>
								<ul className="sched-pop-rows">
									{scheduleRows.map(({ item, last, facts }) => (
										<li className="sched-pop-row" key={item.id}>
											<span className="sched-pop-clock">{item.describe}</span>
											<span className="sched-pop-title">{item.title}</span>
											<span className={"sched-pop-facts" + (last ? " is-" + last.status : "")}>{facts.join(" · ")}</span>
										</li>
									))}
								</ul>
								<button
									type="button"
									className="sched-pop-more"
									onClick={() => {
										setSchedulesOpen(false);
										if (props.selected) props.onViewDetails(props.selected);
									}}
								>
									Open details
								</button>
							</div>
						</PopoverContent>
					</Popover>
				) : null}
			</div>

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
