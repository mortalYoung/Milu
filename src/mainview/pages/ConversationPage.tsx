import { Activity, ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-solid";
import { type Accessor, createEffect, createSignal, type JSX, onCleanup } from "solid-js";
import { AnimatePresence, Motion } from "solid-motion";
import type { CommandDescriptor, CommandExecution, ContextUsage, SandboxMode, SessionStats, SkillDescriptor, ThinkingLevel } from "../../shared/rpc";
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

	historyLoading: Accessor<boolean>;
	busy: Accessor<boolean>;
	onSend: (text: string) => void;
	onStop: () => void;

	commands: CommandDescriptor[];
	onCommand: (line: string) => Promise<CommandExecution>;

	onViewTrajectory?: () => void;

	onCloseTrajectory?: () => void;

	flashId: Accessor<number | null>;

	onEscalationRespond: (id: string, approved: boolean) => void;

	workspacePath: string | null;

	storagePath: string | null;

	sandboxMode: SandboxMode;

	onSetSandboxMode: (mode: SandboxMode) => void;

	model: { provider: string; modelId?: string } | null;

	models: { provider: string; models: { id: string; name: string }[] }[];

	onSetModel: (model: { provider: string; modelId?: string }) => void;
	thinkingLevel: ThinkingLevel;
	thinkingLevels: ThinkingLevel[];
	onSetThinkingLevel: (level: ThinkingLevel) => void;

	contextUsage: ContextUsage | null;

	stats: SessionStats | null;

	workingFor: (name: string) => boolean;

	unread: (name: string) => boolean;

	draft: string;
	onDraftChange: (text: string) => void;
	toastHost?: JSX.Element;
	skills?: SkillDescriptor[];
	onSkill?: (name: string, hint?: string) => Promise<{ ok: boolean; error?: string }>;
	onShell?: (command: string) => Promise<{ ok: boolean; error?: string; shellId?: string }>;
	onSkillInspect?: (name: string) => Promise<string | null>;
	onOpenPath?: (path: string, editorId?: string) => void;
	editors?: { id: string; name: string }[];
}) {
	const [outlineOpen, setOutlineOpen] = createSignal(false);

	const hasConversation = () => props.selected != null && props.entries().length > 0;
	createEffect(() => {
		if (!hasConversation()) {
			setOutlineOpen(false);
			props.onCloseTrajectory?.();
		}
	});

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
							unread={props.unread}
							onSelect={props.onSelect}
							onAddPartner={props.onAddPartner}
							onDelete={props.onDelete}
							onViewDetails={props.onViewDetails}
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

					<div class="btn-group">
						<button
							type="button"
							class="size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-paper-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
							title={outlineOpen() ? "Hide replies" : "Show replies"}
							aria-label="Toggle replies"
							disabled={!hasConversation()}
							onClick={() => {
								if (!outlineOpen()) props.onCloseTrajectory?.();
								setOutlineOpen((v) => !v);
							}}
						>
							<ListTree size={16} />
						</button>

						<button
							type="button"
							class="size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag flex items-center justify-center text-ink hover:bg-paper-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
							title="Open trajectory"
							aria-label="Open trajectory"
							disabled={!hasConversation()}
							onClick={() => {
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
							historyLoading={props.historyLoading}
							worker={props.selected}
							locateFlashId={props.flashId}
							onEscalationRespond={props.onEscalationRespond}
							onSkillInspect={props.onSkillInspect}
						/>
						<Composer
							busy={props.busy}
							onSend={props.onSend}
							onStop={props.onStop}
							commands={props.commands}
							onCommand={props.onCommand}
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
							skills={props.skills}
							onSkill={props.onSkill}
							onShell={props.onShell}
							onOpenPath={props.onOpenPath}
							editors={props.editors}
						/>
					</>
				) : (
					<div class="flex-1 flex flex-col items-center justify-center gap-3 text-center">
						<p class="font-serif text-[17px] text-ink-soft">— select a partner to begin —</p>
						<p class="eyebrow">the directory is on the left</p>
					</div>
				)}
				{props.toastHost}
			</div>

			<RepliesPane open={outlineOpen()} entries={props.entries} />
		</div>
	);
}
