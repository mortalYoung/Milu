/**
 * ConversationPage — the chat page: Partner list on the left (from the config directory) + chat window on the right.
 * The header title follows the selected Partner. A collapsible outline on the right indexes the agent replies
 * so a reply can be located and jumped to quickly.
 */
import { ListTree, PanelLeft, PanelLeftOpen } from "lucide-solid";
import { type Accessor, createMemo, createSignal, For } from "solid-js";
import { AnimatePresence, Motion, MotionConfigProvider } from "solid-motion";
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
	onFlash: (id: number) => void;
	/** The agent message currently visible in the chat (pi id) — drives the trajectory drawer highlight. */
	onVisibleReply?: (piId: string | null) => void;
}) {
	// Outline: floating replies index (direction A); clicking a reply scrolls the transcript to it and flashes the target
	const [outlineOpen, setOutlineOpen] = createSignal(false);
	const [activeReply, setActiveReply] = createSignal<number | null>(null);
	// Each reply carries the question that triggered it, as its anchor
	const replies = createMemo(() => {
		const out: { entry: Entry; question: string; questionId: number }[] = [];
		let lastQuestion = "";
		let lastQuestionId = -1;
		for (const e of props.entries()) {
			if (e.kind === "user") {
				lastQuestion = e.text;
				lastQuestionId = e.id;
			} else if (e.kind === "agent" && e.text.trim() !== "") out.push({ entry: e, question: lastQuestion, questionId: lastQuestionId });
		}
		return out;
	});
	const outlineLabel = (text: string) => {
		const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
		return first.length > 42 ? first.slice(0, 42) + "…" : first;
	};
	// Scroll to the question that triggered the reply (the Q&A pair reads together); flash it
	const locate = (questionId: number, replyId: number) => {
		const target = questionId >= 0 ? questionId : replyId;
		setActiveReply(replyId);
		document.getElementById("entry-" + target)?.scrollIntoView({ behavior: "smooth", block: "start" });
		props.onFlash(target);
	};

	return (
		<div class="chat-page">
			<AnimatePresence>
				{!props.listCollapsed && (
					<Motion as="div" class="shrink-0 h-full" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
						<ConversationList
							partners={props.partners}
							selected={props.selected}
							busy={props.busy}
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
						icon={props.listCollapsed ? <PanelLeft size={16} /> : <PanelLeftOpen size={16} />}
						onClick={props.onToggleList}
					/>
					<div class="chat-worker electrobun-webkit-app-region-no-drag cursor-pointer" title="View details" onClick={() => props.selected && props.onViewDetails(props.selected)}>
						<span>{props.selected ?? "Chat"}</span>
						<span class="chat-worker-sep">·</span>
						<span class="chat-worker-role">{props.partners.find((p) => p.name === props.selected)?.role ?? "partner"}</span>
						{props.busy() && (
							<span class="chat-worker-status" title="Working…">
								<span class="work-dot" />
								<span class="work-dot" />
								<span class="work-dot" />
								Writing…
							</span>
						)}
					</div>
					<Button
						variant="ghost"
						size="icon"
						class="outline-toggle size-8 rounded-full border-0 electrobun-webkit-app-region-no-drag"
						title={outlineOpen() ? "Hide outline" : "Show outline"}
						icon={<ListTree size={16} />}
						onClick={() => setOutlineOpen((v) => !v)}
					/>
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
						<Composer busy={props.busy} onSend={props.onSend} onStop={props.onStop} />
					</>
				) : (
					<div class="flex-1 flex flex-col items-center justify-center gap-3 text-center">
						<p class="font-serif text-[17px] text-ink-soft">— select a partner to begin —</p>
						<p class="eyebrow">the directory is on the left</p>
					</div>
				)}
			</div>

			{/* Outline: floating replies index (direction A); unrolls like a scroll from the top, rows cascade in */}
			<MotionConfigProvider reducedMotion="user">
				<AnimatePresence>
					{outlineOpen() && (
						<Motion
							as="aside"
							class="outline"
							initial={{ opacity: 0, scaleY: 0.94 }}
							animate={{ opacity: 1, scaleY: 1 }}
							exit={{ opacity: 0, scaleY: 0.97 }}
							transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
						>
							<div class="outline-head">
								<span class="eyebrow">Replies</span>
								<span class="outline-count">{replies().length}</span>
							</div>
							<div class="outline-list">
								{replies().length === 0 ? (
									<span class="px-3 py-3 font-sans text-[11px] text-body-muted">no replies yet</span>
								) : (
									<For each={replies()}>
										{(r, i) => (
											<button
												class={"outline-item" + (activeReply() === r.entry.id ? " active" : "")}
												style={{ "animation-delay": `${Math.min(i() * 25, 200)}ms` }}
												onClick={() => locate(r.questionId, r.entry.id)}
											>
												<span class="outline-meta">
													<span class="outline-q">{r.question ? outlineLabel(r.question) : "—"}</span>
													<span class="outline-time">{r.entry.time?.slice(11, 16)}</span>
												</span>
												<span class="outline-a">{outlineLabel(r.entry.text)}</span>
											</button>
										)}
									</For>
								)}
							</div>
						</Motion>
					)}
				</AnimatePresence>
			</MotionConfigProvider>
		</div>
	);
}
