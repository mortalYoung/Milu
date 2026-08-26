/**
 * ConversationPage — the chat page: Partner list on the left (from the config directory) + chat window on the right.
 * The header title follows the selected Partner.
 */
import { Activity, ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-solid";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { AnimatePresence, Motion } from "solid-motion";
import type { ContextUsage, SandboxMode, SessionStats, ThinkingLevel } from "../../shared/rpc";
import { Button } from "../components/Button";
import { Composer } from "../components/Composer";
import { ConversationList, type PartnerItem } from "../components/ConversationList";
import { RepliesPane } from "../components/RepliesPane";
import { type Entry, Transcript } from "../layouts/Transcript";

export function ConversationPage(props: {
	partners: PartnerItem[];
	selected: string | null;
	onSelect: (name: string) => void;
	onAddPartner: () => void;
	onDelete: (name: string) => void;
	onViewDetails: (name: string) => void;
	listCollapsed: boolean;
	onToggleList: () => void;
	entries: Accessor<Entry[]>;
	working: Accessor<boolean>;
	tick: Accessor<number>;
	/** True while persisted history is being (re)read for the selected chat (transcript placeholder). */
	historyLoading: Accessor<boolean>;
	busy: Accessor<boolean>;
	onSend: (text: string) => void;
	onStop: () => void;
	/** Open the trajectory drawer (the whole origin-log timeline; no chat linkage). */
	onViewTrajectory?: () => void;
	/** Close the trajectory drawer (the outline and the drawer are mutually exclusive). */
	onCloseTrajectory?: () => void;
	/** Locate flash: the target bubble briefly flashes seal-soft (replies outline locate). */
	flashId: Accessor<number | null>;
	/** Flash a transcript bubble by entry id (replies pane locate). */
	onFlash: (id: number) => void;
	/** Respond to a pending sandbox escalation (inline Approve/Reject buttons). */
	onEscalationRespond: (id: string, approved: boolean) => void;
	/** The current workspace (shown near the input, read-only; hidden until set_workspace). */
	workspacePath: string | null;
	/** The current storage path (the agent's own directory, shown near the input, read-only). */
	storagePath: string | null;
	/** The per-partner sandbox mode (composer select; human-owned). */
	sandboxMode: SandboxMode;
	/** Persist a new per-partner sandbox mode (composer select onChange). */
	onSetSandboxMode: (mode: SandboxMode) => void;
	/** The per-partner model selection (composer select; human-owned). */
	model: { provider: string; modelId?: string } | null;
	/** Catalog models of every added provider, grouped for the select. */
	models: { provider: string; models: { id: string; name: string }[] }[];
	/** Persist a new per-partner model selection (composer select onChange). */
	onSetModel: (model: { provider: string; modelId?: string }) => void;
	thinkingLevel: ThinkingLevel;
	thinkingLevels: ThinkingLevel[];
	onSetThinkingLevel: (level: ThinkingLevel) => void;
	/** Context occupancy for the composer meter (null before the first turn). */
	contextUsage: ContextUsage | null;
	/** Session-wide metrics (usage totals + TTFT / tok/s) for the composer stats line. */
	stats: SessionStats | null;
	/** Per-partner writing state (true for the row whose partner owns the running run). */
	workingFor: (name: string) => boolean;
	/** The selected chat's saved draft (per-chat, restored on switch-back). */
	draft: string;
	onDraftChange: (text: string) => void;
}) {
	// Replies outline: hidden by default; the header outline icon toggles it
	const [outlineOpen, setOutlineOpen] = createSignal(false);

	// "Has a conversation" = a partner is selected and there are transcript entries.
	// Both the outline and trajectory need something to show; with no messages they are
	// disabled (and any open panel is closed so it can't float over the empty state).
	const hasConversation = () => props.selected != null && props.entries().length > 0;
	createEffect(() => {
		if (!hasConversation()) {
			setOutlineOpen(false);
			props.onCloseTrajectory?.();
		}
	});

	// ESC closes the replies outline (the trajectory drawer already handles its own ESC).
	createEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOutlineOpen(false);
		};
		window.addEventListener("keydown", onKey);
		onCleanup(() => window.removeEventListener("keydown", onKey));
	});

	return (
		<div class="chat-page">
			<AnimatePresence>
				{!props.listCollapsed && (
					<Motion as="div" class="shrink-0 h-full" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
						<ConversationList
							partners={props.partners}
							selected={props.selected}
							working={props.workingFor}
							onSelect={props.onSelect}
							onAddPartner={props.onAddPartner}
							onDelete={props.onDelete}
							onViewDetails={props.onViewDetails}
						/>
					</Motion>
				)}
			</AnimatePresence>

			<div class="chat-window">
				{/* Envelope header: 72px, hairline on top and bottom, centered "name · role"; the list toggle sits at the top left */}
				<div class="chat-header electrobun-webkit-app-region-drag">
					<Button
						variant="ghost"
						size="icon"
						class="chat-toggle size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag"
						title={props.listCollapsed ? "Show chat list" : "Hide chat list"}
						// The icon shows the action: collapsed → open (arrow out), visible → close (arrow in)
						icon={props.listCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
						onClick={props.onToggleList}
					/>
					<div class="chat-worker electrobun-webkit-app-region-no-drag cursor-pointer" title="View details" onClick={() => props.selected && props.onViewDetails(props.selected)}>
						<span>{props.selected ?? "Chat"}</span>
						{props.busy() && (
							<span class="chat-worker-status" title="Working…">
								<span class="work-dot" />
								<span class="work-dot" />
								<span class="work-dot" />
								Writing…
							</span>
						)}
					</div>
					{/* Header action group: outline + trajectory toggles (one absolute anchor, flex row) */}
					<div class="btn-group">
						{/* Outline toggle: header right side, mirror of the list toggle.
					   Plain button (not the Button component) — same pattern as the AppRail
					   rail tabs, which are proven clickable inside the drag-region header. */}
						<button
							type="button"
							class="size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-paper-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
							title={outlineOpen() ? "Hide outline" : "Show outline"}
							aria-label="Toggle replies outline"
							disabled={!hasConversation()}
							onClick={() => {
								// The outline and the trajectory drawer are mutually exclusive: opening one closes the other
								if (!outlineOpen()) props.onCloseTrajectory?.();
								setOutlineOpen((v) => !v);
							}}
						>
							<ListTree size={16} />
						</button>
						{/* Trajectory: the whole-log timeline drawer (header right, mirror of the outline toggle) */}
						<button
							type="button"
							class="size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-paper-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
							title="Open trajectory"
							aria-label="Open trajectory"
							disabled={!hasConversation()}
							onClick={() => {
								// The outline and the trajectory drawer are mutually exclusive: opening one closes the other
								setOutlineOpen(false);
								props.onViewTrajectory?.();
							}}
						>
							<Activity size={16} />
						</button>
					</div>
				</div>
				{props.selected ? (
					<>
						<Transcript
							entries={props.entries}
							working={props.working}
							tick={props.tick}
							historyLoading={props.historyLoading}
							worker={props.selected}
							locateFlashId={props.flashId}
							onEscalationRespond={props.onEscalationRespond}
						/>
						<Composer
							busy={props.busy}
							onSend={props.onSend}
							onStop={props.onStop}
							workspace={props.workspacePath}
							storage={props.storagePath}
							sandboxMode={props.sandboxMode}
							onSetSandboxMode={props.onSetSandboxMode}
							model={props.model}
							models={props.models}
							onSetModel={props.onSetModel}
							thinkingLevel={props.thinkingLevel}
							thinkingLevels={props.thinkingLevels}
							onSetThinkingLevel={props.onSetThinkingLevel}
							contextUsage={props.contextUsage}
							stats={props.stats}
							draft={props.draft}
							onDraftChange={props.onDraftChange}
						/>
					</>
				) : (
					<div class="flex-1 flex flex-col items-center justify-center gap-3 text-center">
						<p class="font-serif text-[17px] text-ink-soft">— select a partner to begin —</p>
						<p class="eyebrow">the directory is on the left</p>
					</div>
				)}
			</div>

			{/* Replies outline: floating index, hidden by default; the header outline icon toggles it */}
			<RepliesPane open={outlineOpen()} entries={props.entries} onFlash={props.onFlash} />
		</div>
	);
}
