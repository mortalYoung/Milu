import { Check, ChevronRight, CircleStop, Pencil } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { EVENTS } from "../../shared/events";
import { BtwPanel } from "../components/BtwPanel";
import { ScrollRegion } from "../components/ScrollRegion";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { useScroll } from "../lib/contexts/scroll-context";
import { useSession } from "../lib/contexts/session-context";
import { useSkills } from "../lib/contexts/skills-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import { type Entry, type EscalationInfo, formatHistoryTime, parseStamp } from "../lib/entries";
import { For, Show } from "../lib/jsx";
import { markdownFilesKey, paintMarkdown, renderMarkdown, renderMarkdownReady } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { blockKey, type ChatBlock } from "../lib/transcript";
import { cn } from "../lib/utils";

const STACK_CARD_MIN_HEIGHT = 96;
const STACK_PEEK = 10;
const STACK_PEEK_STEP = 5;
const STACK_MAX_ROTATION = 2.8;

function seededUnit(seed: number): number {
	const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
	return (x - Math.floor(x)) * 2 - 1;
}

function hashString(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function hasTextSelection(): boolean {
	const selection = window.getSelection();
	return selection != null && !selection.isCollapsed;
}

function Markdown(props: { text: string; files?: string[]; class?: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const filesKey = markdownFilesKey(props.files);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		paintMarkdown(el, renderMarkdown(props.text, props.files));
		void renderMarkdownReady(props.text, props.files).then((html) => {
			if (!cancelled && el.isConnected) paintMarkdown(el, html);
		});
		return () => {
			cancelled = true;
		};
	}, [props.text, filesKey]);

	return <div ref={ref} className={props.class} />;
}

function letterBody(
	card: Entry,
	worker?: string,
	showPostmark = true,
	rich = true,
	onBtw?: (anchorId: string) => void,
	btwActive = false,
	showRail = true,
	onBtwClose?: () => void,
	btwLocked = false,
): ReactNode {
	const stamp = showPostmark ? parseStamp(card.time) : null;
	return (
		<>
			{stamp && (
				<div className="msg-postmark">
					<span>{stamp.date}</span>
					<span>{stamp.time}</span>
				</div>
			)}
			{rich ? <Markdown text={card.text} files={card.files} class="md msg-letter-text" /> : <div className="msg-letter-text">{card.text}</div>}
			{worker && (
				<div className="msg-sign">
					— {worker} · {formatHistoryTime(card.time)}
				</div>
			)}
			{onBtw && card.kind === "agent" && showRail && (
				<button
					type="button"
					className={"msg-rail" + (btwActive ? " on" : "")}
					aria-label={btwActive ? "Close side question" : "Ask a side question about this message"}
					onClick={(event) => {
						event.stopPropagation();
						if (btwActive) onBtwClose?.();
						else if (!btwLocked) onBtw(card.key ?? String(card.id));
					}}
					onMouseMove={(event) => {
						const el = event.currentTarget;
						const rect = el.getBoundingClientRect();
						const half = 58;
						const y = Math.min(Math.max(event.clientY - rect.top, half), Math.max(half, rect.height - half));
						el.style.setProperty("--rail-y", `${y}px`);
					}}
					onMouseLeave={(event) => {
						event.currentTarget.style.removeProperty("--rail-y");
					}}
				>
					<span className="msg-rail-indicator">
						<ChevronRight size={10} strokeWidth={2} />
					</span>
				</button>
			)}
		</>
	);
}

function escalationBody(esc: EscalationInfo, onRespond?: (id: string, approved: boolean) => void): ReactNode {
	return (
		<>
			<div className="msg-escalation-head">sandbox escalation</div>
			<pre className="msg-escalation-cmd">{esc.command}</pre>
			<div className="msg-escalation-meta">
				<span>
					{esc.from} → <b>{esc.to}</b>
				</span>
				{esc.justification && <span className="msg-escalation-just">justification: {esc.justification}</span>}
			</div>
			{esc.status === "pending" ? (
				<div className="msg-escalation-actions">
					<button type="button" className="msg-escalation-btn" onClick={() => onRespond?.(esc.id, false)}>
						Reject
					</button>
					<button type="button" className="msg-escalation-btn msg-escalation-btn-approve" onClick={() => onRespond?.(esc.id, true)}>
						Approve
					</button>
				</div>
			) : (
				<div className={"msg-escalation-status" + (esc.status === "approved" ? " ok" : esc.status === "rejected" ? " no" : " drp")}>{esc.status}</div>
			)}
		</>
	);
}

function MessageStack(props: {
	cards: Entry[];
	anchorKey: string;
	worker?: string;
	locateFlashId?: number | null;
	onEscalationRespond?: (id: string, approved: boolean) => void;
	onBtw?: (anchorId: string) => void;
	onBtwClose?: () => void;
	activeBtwAnchor?: string | null;
}) {
	const [current, setCurrent] = useState(props.cards.length - 1);
	const previousLength = useRef(props.cards.length);

	if (props.cards.length !== previousLength.current) {
		previousLength.current = props.cards.length;
		setCurrent(props.cards.length - 1);
	}

	const previous = () => setCurrent(Math.max(0, current - 1));
	const next = () => setCurrent(Math.min(props.cards.length - 1, current + 1));

	return (
		<div className="msg-stack" style={{ paddingTop: `${STACK_PEEK}px` }} data-chat-anchor-key={props.anchorKey}>
			<For each={props.cards}>
				{(card, index) => {
					const depth = (current - index() + props.cards.length) % props.cards.length;
					const layer = Math.min(depth, 2);
					const peek = layer * STACK_PEEK_STEP;
					const jitter = depth <= 2 ? seededUnit(hashString(card.text)) : 0;
					const rotation = Math.max(-STACK_MAX_ROTATION, Math.min(STACK_MAX_ROTATION, (layer % 2 ? 1 : -1) * layer * 1.4 + jitter * 0.8));
					return (
						<div
							className={"msg-letter msg-stack-card" + (depth === 0 ? " on-top" : "") + (props.locateFlashId === card.id ? " locate-flash" : "")}
							id={"entry-" + card.id}
							data-chat-anchor-key={card.key ?? String(card.id)}
							style={{
								transform: depth === 0 ? undefined : `translate(${jitter * 3}px, ${-(peek + jitter * 2)}px) rotate(${rotation}deg)`,
								zIndex: 10 - depth,
								...(depth === 0 ? { minHeight: `${STACK_CARD_MIN_HEIGHT}px` } : { height: `${STACK_CARD_MIN_HEIGHT}px`, overflow: "hidden" }),
							}}
						>
							{card.kind === "escalation" && card.escalation
								? escalationBody(card.escalation, props.onEscalationRespond)
								: letterBody(
										card,
										props.worker,
										depth === 0,
										depth <= 2,
										props.onBtw,
										props.activeBtwAnchor === card.key,
										depth === 0,
										props.onBtwClose,
										!!props.activeBtwAnchor && props.activeBtwAnchor !== card.key,
									)}
						</div>
					);
				}}
			</For>
			{props.cards.length > 1 && (
				<div className="msg-stack-nav">
					<button type="button" className="msg-stack-switch" title="Previous reply" onClick={previous} disabled={current === 0}>
						‹
					</button>
					<span className="msg-stack-count">
						{current + 1} / {props.cards.length}
					</span>
					<button type="button" className="msg-stack-switch" title="Next reply" onClick={next} disabled={current === props.cards.length - 1}>
						›
					</button>
				</div>
			)}
		</div>
	);
}

export function Transcript(props: {
	working: boolean;
	historyLoading: boolean;
	worker?: string;
	onEscalationRespond?: (id: string, approved: boolean) => void;
	onBtw?: (anchorId: string) => void;
	onBtwClose?: () => void;
	activeBtwAnchor?: string | null;
}) {
	const controller = useTranscript();
	const session = useSession();
	const skillDirectory = useSkills();
	const scroll = useScroll();

	const { items, blocks } = useStore(controller.store, (state) => state);
	const locateFlashId = useStore(scroll.store, (state) => state.locateFlashId);
	const entries = useStore(session.store, (state) => state.origin.entries);
	const hasMore = useStore(session.store, (state) => state.origin.hasMore);
	const originLoading = useStore(session.store, (state) => state.origin.loading);

	const [expandedCommand, setExpandedCommand] = useState<string | null>(null);
	const [collapsedShells, setCollapsedShells] = useState<Set<string>>(() => new Set());
	const [skillDialog, setSkillDialog] = useState<{ name: string; content: string } | null>(null);
	const [editingUserKey, setEditingUserKey] = useState<string | null>(null);
	const [editDraft, setEditDraft] = useState("");
	const [editSaving, setEditSaving] = useState(false);
	const [editError, setEditError] = useState<string | null>(null);

	const userEditEls = useRef(new Map<string, HTMLDivElement>());
	const pinnedShellOutput = useRef(new Set<string>());

	function toggleShellOutput(key: string) {
		setCollapsedShells((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	useEffect(() => {
		for (const entry of items) {
			if (entry.kind !== "shell" || !entry.command?.text) continue;
			const box = document.getElementById("entry-" + entry.id)?.querySelector<HTMLElement>(".is-shell-out");
			if (!box) continue;
			const key = entry.key ?? String(entry.id);
			if (pinnedShellOutput.current.has(key)) continue;
			pinnedShellOutput.current.add(key);
			box.scrollTop = box.scrollHeight;
		}
	}, [items]);

	async function inspectSkill(name: string) {
		const res = await skillDirectory.mutate.inspect(name);
		if (res.ok && res.content != null) setSkillDialog({ name, content: res.content });
	}

	const editableUserKey = useMemo<string | null>(() => {
		let last = -1;
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i]!;
			if (entry.type === "message" && entry.message.role === "user" && typeof (entry.message as { skill?: unknown }).skill !== "string") last = i;
		}
		if (last < 0) return null;
		let sawAborted = false;
		for (let i = last + 1; i < entries.length; i++) {
			const entry = entries[i]!;
			if (entry.type === "message" && entry.message.role === "user" && typeof (entry.message as { skill?: unknown }).skill !== "string") return null;
			if (entry.type !== "custom") continue;
			if (entry.customType === EVENTS.commandRun || entry.customType === EVENTS.skillRun || entry.customType === EVENTS.shellRun) return null;
			if (entry.customType === EVENTS.agentEnd) {
				const reason = (entry.data as { reason?: unknown } | undefined)?.reason;
				if (reason === "completed") return null;
				if (reason === "aborted") sawAborted = true;
			}
		}
		return sawAborted ? String(entries[last]!.id) : null;
	}, [entries]);

	function startEdit(key: string, text: string) {
		setEditingUserKey(key);
		setEditDraft(text);
		setEditError(null);
		setEditSaving(false);
	}

	function cancelEdit() {
		setEditingUserKey(null);
		setEditError(null);
		setEditSaving(false);
	}

	async function saveEdit() {
		const key = editingUserKey;
		if (!key || editSaving) return;
		setEditSaving(true);
		setEditError(null);
		const res = await rpc.request.edit_last_user({ text: editDraft.trimEnd() });
		setEditSaving(false);
		if (!res.ok) {
			setEditError(res.error ?? "Edit failed");
			return;
		}
		setEditingUserKey(null);
		await session.mutate.refreshHistory();
	}

	useEffect(() => {
		if (!editingUserKey) return;
		const el = userEditEls.current.get(editingUserKey);
		if (el) requestAnimationFrame(() => el.focus());
	}, [editingUserKey]);

	useEffect(() => {
		const anchor = props.activeBtwAnchor;
		const inner = scroll.store.getState().contentEl;
		if (!anchor || !inner) return;

		let anchorEl: HTMLElement | null = null;
		for (const block of blocks) {
			const cards = Array.isArray(block) ? block : [block];
			const card = cards.find((c) => (c.key ?? String(c.id)) === anchor);
			if (card) {
				anchorEl = document.getElementById("entry-" + card.id);
				break;
			}
		}
		if (!anchorEl) return;
		const target = anchorEl;

		const update = () => {
			inner.style.setProperty("--btw-top", `${scroll.offsetInContent(target)}px`);
			inner.style.setProperty("--btw-height", `${target.getBoundingClientRect().height}px`);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(target);
		observer.observe(inner);
		return () => observer.disconnect();
	}, [props.activeBtwAnchor, blocks, scroll]);

	const worker = props.worker;
	const btwAnchor = props.activeBtwAnchor;

	return (
		<MotionConfig reducedMotion="user">
			<ScrollRegion scroll={scroll} class="transcript flex-1 min-h-0 px-4 py-3" id="transcript" ariaLive="polite" innerClass={cn("transcript-inner", btwAnchor && "btw-open")}>
				{items.length === 0 && !props.working && (
					<div className="text-center pt-16">
						{props.historyLoading ? (
							<>
								<p className="font-serif text-[17px] text-ink-soft">— reading the archives… —</p>
								<p className="eyebrow mt-3">restoring the conversation from disk</p>
							</>
						) : (
							<>
								<p className="font-serif text-[17px] text-ink-soft">— waiting for your first prompt —</p>
								<p className="eyebrow mt-3">ask it to read a file, run a command, or just talk</p>
							</>
						)}
					</div>
				)}

				<Show when={hasMore}>
					<div className="load-earlier-wrap">
						<button
							type="button"
							className="load-earlier"
							onClick={() => {
								scroll.hold();
								void session.mutate.loadOlderHistory();
							}}
							disabled={originLoading}
						>
							{originLoading ? "loading…" : "↑ load earlier"}
						</button>
					</div>
				</Show>

				<For each={blocks} by={blockKey}>
					{(block: ChatBlock) => {
						if (Array.isArray(block)) {
							const card = block[0]!;
							const key = blockKey(block);
							if (block.length === 1) {
								if (card.kind === "escalation" && card.escalation) {
									return (
										<div className="msg-escalation" id={"entry-" + card.id} data-chat-anchor-key={key}>
											{escalationBody(card.escalation, props.onEscalationRespond)}
										</div>
									);
								}
								return (
									<motion.div
										className={"msg-letter" + (locateFlashId === card.id ? " locate-flash" : "") + (btwAnchor === key ? " btw-active" : "")}
										id={"entry-" + card.id}
										data-chat-anchor-key={key}
										initial={{ opacity: 0, scale: 0.96, rotate: 0.4 }}
										animate={{ opacity: 1, scale: 1, rotate: 0 }}
										transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
									>
										{letterBody(card, worker, true, true, props.onBtw, btwAnchor === key, true, props.onBtwClose, !!btwAnchor && btwAnchor !== key)}
									</motion.div>
								);
							}
							return (
								<MessageStack
									cards={block}
									anchorKey={key}
									worker={worker}
									locateFlashId={locateFlashId}
									onEscalationRespond={props.onEscalationRespond}
									onBtw={props.onBtw}
									onBtwClose={props.onBtwClose}
									activeBtwAnchor={btwAnchor}
								/>
							);
						}

						const entry = block;
						const key = blockKey(block);
						if (entry.kind === "user") {
							const isEditing = editingUserKey === key;
							return (
								<div className="msg-user-row group" data-chat-anchor-key={key}>
									<div
										className={"msg-user" + (isEditing ? " msg-user-editing" : "") + (locateFlashId === entry.id ? " locate-flash" : "")}
										id={"entry-" + entry.id}
										data-chat-anchor-key={key}
										contentEditable={isEditing ? "plaintext-only" : undefined}
										role={isEditing ? "textbox" : undefined}
										aria-multiline={isEditing ? true : undefined}
										ref={(el) => {
											if (el) userEditEls.current.set(key, el);
										}}
										onInput={(event) => {
											if (!isEditing) return;
											setEditDraft((event.currentTarget as HTMLElement).innerText ?? "");
										}}
										onKeyDown={(event) => {
											if (!isEditing) return;
											if (event.key === "Escape") {
												event.preventDefault();
												cancelEdit();
											}
											if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
												event.preventDefault();
												void saveEdit();
											}
										}}
									>
										{entry.text}
									</div>
									<span className="msg-user-meta">
										{isEditing ? (
											<span className="msg-user-edit-hint">{editSaving ? "resending…" : "enter save · esc cancel"}</span>
										) : (
											<>
												<span className="msg-user-time">{formatHistoryTime(entry.time)}</span>
												{key === editableUserKey && !props.working && (
													<button type="button" className="msg-user-edit-link" title="Edit message" aria-label="Edit message" onClick={() => startEdit(key, entry.text)}>
														<Pencil size={12} />
													</button>
												)}
											</>
										)}
									</span>
									{isEditing && editError && <p className="msg-user-edit-error">{editError}</p>}
								</div>
							);
						}
						if (entry.kind === "sys") {
							if (entry.error) {
								return (
									<div className="sys-error" data-chat-anchor-key={key}>
										<span className="sys-error-tag">ERR</span>
										<span className="sys-error-text">{entry.text}</span>
									</div>
								);
							}
							if (entry.aborted) {
								return (
									<div className="sys-stopped" data-chat-anchor-key={key}>
										<CircleStop size={12} />
										<span>{entry.text}</span>
									</div>
								);
							}
							return (
								<div className="sys" data-chat-anchor-key={key}>
									{entry.text}
								</div>
							);
						}
						if ((entry.kind === "command" || entry.kind === "skill" || entry.kind === "shell") && (entry.command ?? entry.skill)) {
							const info = entry.kind === "skill" ? entry.skill! : entry.command!;
							const args = info.args;
							const output = info.text;
							const foldable = entry.kind === "command" ? !!args : entry.kind === "shell" ? !!output : false;
							const rowKey = entry.key ?? String(entry.id);
							const isOpen = entry.kind === "shell" ? !collapsedShells.has(rowKey) : expandedCommand === rowKey;
							const onRowClick = () => {
								if (hasTextSelection()) return;
								if (entry.kind === "shell") toggleShellOutput(rowKey);
								else setExpandedCommand(isOpen ? null : rowKey);
							};
							return (
								<div
									className={
										"msg-command" +
										(info.status === "success" ? " ok" : "") +
										(info.status === "error" ? " is-error" : "") +
										(entry.kind === "skill" ? " is-skill" : "") +
										(entry.kind === "shell" ? " is-shell" : "")
									}
									id={"entry-" + entry.id}
									data-chat-anchor-key={key}
									onClick={entry.kind === "skill" ? () => void inspectSkill(info.name) : undefined}
									role={entry.kind === "skill" ? "button" : undefined}
								>
									<div
										className={"msg-command-head" + (foldable ? " is-foldable" : "")}
										onClick={foldable ? onRowClick : undefined}
										role={foldable ? "button" : undefined}
										aria-expanded={foldable ? isOpen : undefined}
									>
										{entry.kind === "skill" ? (
											<span className="msg-command-badge">skill</span>
										) : entry.kind === "shell" ? (
											<span className="msg-command-badge">shell</span>
										) : (
											<span className="msg-command-badge">command</span>
										)}
										<span className="msg-command-name">{info.name}</span>
										<span className={"msg-command-status " + info.status}>
											{info.status === "success" ? <Check size={12} /> : null}
											{info.status === "error" ? "error" : null}
											{info.status === "interrupted" ? "interrupted" : null}
											{info.status === "running" ? (
												<span className="msg-command-running">
													<span className="work-dot" />
													<span className="work-dot" />
													<span className="work-dot" />
												</span>
											) : null}
										</span>
									</div>
									{entry.kind === "skill" ? (
										args ? (
											<div className="msg-command-args">{args}</div>
										) : null
									) : entry.kind === "shell" ? (
										isOpen && output ? (
											<div className="msg-command-args is-shell-out">{output}</div>
										) : null
									) : info.status === "error" && output ? (
										<div className="msg-command-args is-command-error">{output}</div>
									) : isOpen && args ? (
										<div className="msg-command-args">{args}</div>
									) : null}
								</div>
							);
						}
						return (
							<div className="time-sep" data-chat-anchor-key={key}>
								{entry.text}
							</div>
						);
					}}
				</For>

				<AnimatePresence>
					{props.working && (
						<motion.div
							key="speaking"
							className="msg-letter msg-speaking"
							initial={{ opacity: 0, scale: 0.97 }}
							animate={{ opacity: 1, scale: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
						>
							<div className="msg-speaking-dots">
								<span className="work-dot" />
								<span className="work-dot" />
								<span className="work-dot" />
							</div>
							{worker && <div className="msg-sign">— {worker} is writing…</div>}
						</motion.div>
					)}
				</AnimatePresence>

				<Show when={btwAnchor && worker}>
					<div className="btw-cell">
						<BtwPanel name={worker!} anchorEntryId={btwAnchor!} onClose={() => props.onBtwClose?.()} />
					</div>
				</Show>
			</ScrollRegion>

			<Dialog open={skillDialog != null} onOpenChange={(open) => !open && setSkillDialog(null)}>
				<DialogContent focusClose className="w-[560px] max-w-[560px] bg-paper p-0 gap-0">
					<DialogTitle className="sr-only">{skillDialog?.name ?? ""}</DialogTitle>
					<div className="flex max-h-[70vh] flex-col gap-3 p-5">
						<div className="font-mono text-[13px] font-medium text-ink">skill · {skillDialog?.name}</div>
						<div className="md md-wrap-pre overflow-y-auto overflow-x-hidden" dangerouslySetInnerHTML={{ __html: renderMarkdown(skillDialog?.content ?? "") }} />
					</div>
				</DialogContent>
			</Dialog>
		</MotionConfig>
	);
}
