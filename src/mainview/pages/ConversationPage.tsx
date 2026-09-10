import { Activity, Folder, GitBranch, ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-solid";
import { type Accessor, createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";
import { AnimatePresence, Motion } from "solid-motion";
import { Button } from "../components/Button";
import { Composer } from "../components/Composer";
import { ConversationList, type PartnerItem } from "../components/ConversationList";
import { ExplorerDrawer } from "../components/ExplorerDrawer";
import { GitChangesDrawer } from "../components/GitChangesDrawer";
import { RepliesPane } from "../components/RepliesPane";
import { Transcript } from "../layouts/Transcript";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useSettings } from "../lib/contexts/settings-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import type { Dock } from "../lib/dock";

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
	onToggleList: () => void;

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
	const workspacePath = () => status.data().workspace_path;
	const hasWorkspace = () => workspacePath() != null;
	const gitAvailable = () => hasWorkspace() && status.data().is_git_repo;
	const hasDockTools = () => hasWorkspace() || gitAvailable();
	createEffect(() => {
		if (!hasWorkspace() && panel() === "explorer") props.dock.close();
	});
	createEffect(() => {
		if (!gitAvailable() && panel() === "git") props.dock.close();
	});

	const hasConversation = () => props.selected != null && transcript.view().length > 0;
	const dockSide = () => settings.data()?.settings?.dockSide ?? "right";
	const preserveTranscriptScroll = (toggle: () => void) => {
		const el = document.getElementById("transcript");
		const prev = el?.scrollTop;
		toggle();
		if (el && prev != null) {
			requestAnimationFrame(() => {
				el.scrollTop = prev;
			});
		}
	};
	createEffect(() => {
		if (!hasConversation()) {
			props.dock.close();
			setBtwOpen(false);
			setBtwAnchor(null);
			trajectory.mutate.setOpen(false);
		}
	});

	createEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && panel() === "replies") props.dock.close();
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => window.removeEventListener("keydown", onKey));
	});

	const headerIconClass =
		"size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-paper-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper";
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
				<div class="chat-header electrobun-webkit-app-region-drag">
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
							title="Open trajectory"
							aria-label="Open trajectory"
							disabled={!hasConversation()}
							onClick={() => {
								props.dock.close();
								trajectory.mutate.view();
							}}
						>
							<Activity size={16} />
						</button>
					</div>
				</div>
				{props.selected ? (
					<div class="chat-body" classList={{ "btw-open": btwOpen() }}>
						<div class="chat-main">
							<div class="chat-transcript-region">
								<Transcript
									working={status.isBusyForSelected}
									historyLoading={props.historyLoading}
									worker={props.selected}
									onEscalationRespond={props.onEscalationRespond}
									onBtw={(anchor) => {
										preserveTranscriptScroll(() => {
											setBtwAnchor(anchor);
											setBtwOpen(true);
										});
									}}
									onBtwClose={() =>
										preserveTranscriptScroll(() => {
											setBtwAnchor(null);
											setBtwOpen(false);
										})
									}
									activeBtwAnchor={btwOpen() ? btwAnchor() : null}
								/>
								<ExplorerDrawer open={panel() === "explorer"} partner={props.selected} reveal={props.dock.reveal()} side={dockSide()} onClose={() => props.dock.close()} />
								<GitChangesDrawer open={panel() === "git"} partner={props.selected} side={dockSide()} onClose={() => props.dock.close()} />
							</div>
							<Composer onSend={props.onSend} onStop={props.onStop} onShell={props.onShell} onOpenPath={props.onOpenPath} editors={props.editors} />
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
