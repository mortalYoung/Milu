/**
 * ConversationPage — the chat page: Partner list on the left (from the config directory) + chat window on the right.
 * The header title follows the selected Partner.
 */
import { PanelLeftClose, PanelLeftOpen } from "lucide-solid";
import { type Accessor } from "solid-js";
import { AnimatePresence, Motion } from "solid-motion";
import type { ContextUsage } from "../../shared/rpc";
import { Button } from "../components/Button";
import { Composer } from "../components/Composer";
import { ConversationList, type PartnerItem } from "../components/ConversationList";
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
	busy: Accessor<boolean>;
	onSend: (text: string) => void;
	onStop: () => void;
	onViewTrajectory?: (piId: string) => void;
	/** Locate flash (shared with the trajectory drawer): the target bubble briefly flashes seal-soft. */
	flashId: Accessor<number | null>;
	/** The agent message currently visible in the chat (pi id) — drives the trajectory drawer highlight. */
	onVisibleReply?: (piId: string | null) => void;
	/** The current workspace (shown near the input, read-only). */
	workspacePath: string | null;
	/** Default workspace (project root) shown when the agent has not set one yet. */
	workspaceDefault: string;
	/** Context occupancy for the composer meter (null before the first turn). */
	contextUsage: ContextUsage | null;
	/** Per-partner writing state (true for the row whose partner owns the running run). */
	workingFor: (name: string) => boolean;
	/** The selected chat's saved draft (per-chat, restored on switch-back). */
	draft: string;
	onDraftChange: (text: string) => void;
}) {
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
				</div>
				{props.selected ? (
					<>
						<Transcript
							entries={props.entries}
							working={props.working}
							tick={props.tick}
							worker={props.selected}
							onViewTrajectory={props.onViewTrajectory}
							locateFlashId={props.flashId}
							onVisibleReply={props.onVisibleReply}
						/>
						<Composer
							busy={props.busy}
							onSend={props.onSend}
							onStop={props.onStop}
							workspace={props.workspacePath}
							workspaceDefault={props.workspaceDefault}
							contextUsage={props.contextUsage}
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
		</div>
	);
}
