import { Check, ChevronRight, CircleStop, Copy, Pencil } from "lucide-react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { EVENTS } from "../../shared/events";
import { BtwPanel } from "../components/BtwPanel";
import { FloatFind } from "../components/FloatFind";
import { ScrollRegion } from "../components/ScrollRegion";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { registerSurfaceRoot } from "../lib/active-surface";
import { copyText } from "../lib/clipboard";
import { useScroll } from "../lib/contexts/scroll-context";
import { useSession } from "../lib/contexts/session-context";
import { useSkills } from "../lib/contexts/skills-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import { type Entry, type EscalationInfo, formatHistoryTime, parseStamp } from "../lib/entries";
import { domFindEngine, revealRange, useFindBar, useFindHandler } from "../lib/find";
import { For, Show } from "../lib/jsx";
import { markdownFilesKey, paintMarkdown, renderMarkdown, renderMarkdownReady } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { SURFACE } from "../lib/surfaces";
import { blockKey, type ChatBlock } from "../lib/transcript";
import { cn } from "../lib/utils";

const TRANSCRIPT_SKIP = [".load-earlier", ".md-copy", ".btw-cell", ".msg-rail", ".msg-fold"];

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

function CopyMessage(props: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className={"msg-copy" + (copied ? " copied" : "")}
			title={copied ? "Copied" : "Copy message"}
			aria-label={copied ? "Copied" : "Copy message"}
			onClick={() => {
				copyText(props.text);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? <Check size={11} /> : <Copy size={11} />}
		</button>
	);
}

function messageBody(
	card: Entry,
	worker?: string,
	rich = true,
	onBtw?: (anchorId: string) => void,
	btwActive = false,
	showRail = true,
	onBtwClose?: () => void,
	btwLocked = false,
	fold?: ReactNode,
): ReactNode {
	const stamp = parseStamp(card.time);
	return (
		<>
			<span className="sr-only">{worker ?? "agent"}</span>
			{rich ? <Markdown text={card.text} files={card.files} class="md msg-body" /> : <div className="msg-body">{card.text}</div>}
			<div className="msg-meta">
				<CopyMessage text={card.text} />
				<span className="msg-at" title={[stamp?.date, stamp?.time].filter(Boolean).join(" ")}>
					{stamp?.time}
				</span>
				{card.to && <span className="msg-chip">→ {card.to}</span>}
				{fold}
			</div>
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

function StackFold(props: {
	cards: Entry[];
	anchorKey: string;
	worker?: string;
	locateFlashId?: number | null;
	onEscalationRespond?: (id: string, approved: boolean) => void;
	onBtw?: (anchorId: string) => void;
	onBtwClose?: () => void;
	activeBtwAnchor?: string | null;
}) {
	const [open, setOpen] = useState(false);
	const folded = Math.max(0, props.cards.length - 1);
	const shown = open ? props.cards : props.cards.slice(-1);
	const last = props.cards[props.cards.length - 1]!;
	const canFold = last.kind !== "escalation";
	const foldButton = (
		<button type="button" className="msg-fold" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
			{open ? `fold ${folded}` : `+${folded} earlier`}
		</button>
	);

	return (
		<div className="msg-fold-group" data-chat-anchor-key={props.anchorKey}>
			<For each={shown}>
				{(card) => (
					<div
						className={"msg-block msg-block-agent" + (props.locateFlashId === card.id ? " locate-flash" : "")}
						id={"entry-" + card.id}
						data-chat-anchor-key={card.key ?? String(card.id)}
					>
						{card.kind === "escalation" && card.escalation
							? escalationBody(card.escalation, props.onEscalationRespond)
							: messageBody(
									card,
									props.worker,
									true,
									props.onBtw,
									props.activeBtwAnchor === card.key,
									true,
									props.onBtwClose,
									!!props.activeBtwAnchor && props.activeBtwAnchor !== card.key,
									folded > 0 && card.id === last.id && canFold ? foldButton : undefined,
								)}
					</div>
				)}
			</For>
			{folded > 0 && !canFold && foldButton}
		</div>
	);
}

export function Transcript(props: {
	working: boolean;
	historyLoading: boolean;
	dockOpen?: boolean;
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
	const reduceMotion = useReducedMotion();

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

	const findRoot = useRef<HTMLDivElement | null>(null);
	const revealMatch = useCallback(
		(range: Range) => {
			const element = range.startContainer.parentElement;
			const container = scroll.store.getState().containerEl;
			if (!element || !container) return;
			scroll.seek(Math.max(0, scroll.offsetInContent(element) - (container.clientHeight - element.getBoundingClientRect().height) / 2));
			revealRange(range);
		},
		[scroll],
	);
	const findEngine = useCallback(() => domFindEngine(findRoot.current, TRANSCRIPT_SKIP, revealMatch), [revealMatch]);
	const find = useFindBar({ engine: findEngine, canClaim: () => items.length > 0 });
	const closeFind = find.close;

	useEffect(() => {
		if (props.dockOpen) closeFind();
	}, [props.dockOpen, closeFind]);
	useFindHandler(SURFACE.transcript, () => find.claim());

	useEffect(() => {
		const column = findRoot.current?.closest(".chat-column") ?? findRoot.current;
		return column ? registerSurfaceRoot(column, SURFACE.transcript) : undefined;
	}, []);

	useEffect(() => {
		if (!find.open) return;
		const content = scroll.store.getState().contentEl;
		if (!content) return;
		const observer = new MutationObserver(() => find.refresh());
		observer.observe(content, { subtree: true, childList: true, characterData: true });
		return () => observer.disconnect();
	}, [find.open, find.refresh, scroll]);

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
			if (
				entry.type === "message" &&
				entry.message.role === "user" &&
				typeof (entry.message as { skill?: unknown }).skill !== "string" &&
				(entry.message as { from?: unknown }).from === undefined
			)
				last = i;
		}
		if (last < 0) return null;
		let sawAborted = false;
		for (let i = last + 1; i < entries.length; i++) {
			const entry = entries[i]!;
			if (
				entry.type === "message" &&
				entry.message.role === "user" &&
				typeof (entry.message as { skill?: unknown }).skill !== "string" &&
				(entry.message as { from?: unknown }).from === undefined
			)
				return null;
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
			<ScrollRegion
				scroll={scroll}
				class="transcript flex-1 min-h-0 px-4 py-3"
				id="transcript"
				ariaLive="polite"
				innerClass={cn("transcript-inner", btwAnchor && "btw-open")}
				root={findRoot}
				overlay={<AnimatePresence>{find.open ? <FloatFind {...find.props} hint={hasMore ? "only loaded messages are searched" : undefined} /> : null}</AnimatePresence>}
			>
				{items.length === 0 && !props.working && (
					<div className="text-center pt-16">
						{props.historyLoading ? (
							<>
								<p className="font-serif text-[16px] text-ink-soft">— loading… —</p>
								<p className="eyebrow mt-3">restoring the conversation from disk</p>
							</>
						) : (
							<>
								<p className="font-serif text-[16px] text-ink-soft">— waiting for your first prompt —</p>
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
										className={"msg-block msg-block-agent" + (locateFlashId === card.id ? " locate-flash" : "") + (btwAnchor === key ? " btw-active" : "")}
										id={"entry-" + card.id}
										data-chat-anchor-key={key}
										initial={{ opacity: 0, y: 6 }}
										animate={{ opacity: 1, y: 0 }}
										transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
									>
										{messageBody(card, worker, true, props.onBtw, btwAnchor === key, true, props.onBtwClose, !!btwAnchor && btwAnchor !== key)}
									</motion.div>
								);
							}
							return (
								<StackFold
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
								<div className="msg-block msg-block-user group" data-chat-anchor-key={key}>
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
									<span className="sr-only">you</span>
									<div className="msg-meta">
										<span className="msg-at">{formatHistoryTime(entry.time)}</span>
										{entry.from && <span className="msg-chip">from {entry.from}</span>}
										{isEditing ? (
											<span className="msg-user-edit-hint">{editSaving ? "resending…" : "enter save · esc cancel"}</span>
										) : (
											key === editableUserKey &&
											!props.working && (
												<button type="button" className="msg-user-edit-link" title="Edit message" aria-label="Edit message" onClick={() => startEdit(key, entry.text)}>
													<Pencil size={12} />
												</button>
											)
										)}
									</div>
									{isEditing && editError && <p className="msg-user-edit-error">{editError}</p>}
								</div>
							);
						}
						if (entry.kind === "reply") {
							return (
								<div className="msg-reply" data-chat-anchor-key={key}>
									<div className="msg-reply-head">
										<span>{entry.reply?.from} · reply</span>
										<span className="msg-reply-time">{entry.time}</span>
									</div>
									<div className="msg-reply-body">{entry.text}</div>
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
							className="msg-block msg-speaking"
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
						>
							<div className="msg-speaking-dots">
								<span className="work-dot" />
								<span className="work-dot" />
								<span className="work-dot" />
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				<AnimatePresence>
					{btwAnchor && worker && (
						<motion.div
							key="btw"
							className="btw-cell"
							initial={{ opacity: 0, clipPath: "inset(0% 100% 0% 0%)" }}
							animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)" }}
							exit={{ opacity: 0, clipPath: "inset(0% 100% 0% 0%)", transition: { duration: reduceMotion ? 0 : 0.16, ease: [0.23, 1, 0.32, 1] } }}
							transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.23, 1, 0.32, 1] }}
						>
							<BtwPanel name={worker} anchorEntryId={btwAnchor} onClose={() => props.onBtwClose?.()} />
						</motion.div>
					)}
				</AnimatePresence>
			</ScrollRegion>

			<Dialog open={skillDialog != null} onOpenChange={(open) => !open && setSkillDialog(null)}>
				<DialogContent focusClose className="w-[560px] max-w-[560px] bg-canvas p-0 gap-0">
					<DialogTitle className="sr-only">{skillDialog?.name ?? ""}</DialogTitle>
					<div className="flex max-h-[70vh] flex-col gap-3 p-5">
						<div className="font-mono text-[13.5px] font-medium text-ink">skill · {skillDialog?.name}</div>
						<div className="md md-wrap-pre overflow-y-auto overflow-x-hidden" dangerouslySetInnerHTML={{ __html: renderMarkdown(skillDialog?.content ?? "") }} />
					</div>
				</DialogContent>
			</Dialog>
		</MotionConfig>
	);
}
