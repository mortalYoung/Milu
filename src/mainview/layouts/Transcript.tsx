import { Check, CircleStop } from "lucide-solid";
import { type Accessor, createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { AnimatePresence, Motion, MotionConfigProvider } from "solid-motion";
import type { EscalationStatus, SandboxMode } from "../../shared/rpc";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { useSession } from "../lib/contexts/session-context";
import { useSkills } from "../lib/contexts/skills-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import { renderMarkdown, renderMarkdownPlain } from "../lib/markdown";

export interface EscalationInfo {
	id: string;
	command: string;
	from: SandboxMode;
	to: SandboxMode;
	justification: string;
	status: EscalationStatus;
}

export interface CommandInfo {
	commandId: string;
	name: string;
	args?: string;
	text?: string;
	status: "running" | "success" | "error" | "interrupted";
}

export interface Entry {
	id: number;
	kind: "user" | "agent" | "sys" | "sep" | "escalation" | "command" | "skill" | "shell";
	text: string;
	time?: string;
	error?: boolean;
	aborted?: boolean;
	escalation?: EscalationInfo;
	command?: CommandInfo;
	skill?: CommandInfo;

	key?: string;
}

let nextId = 1;
const pad = (n: number) => String(n).padStart(2, "0");

const fmtDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export function makeUserEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "user", text, time: fmtDateTime(new Date(time)) };
}

export function makeAgentEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "agent", text, time: fmtDateTime(new Date(time)) };
}

export function makeEscalationEntry(item: { text: string; time: number; escalation: EscalationInfo }): Entry {
	return { id: nextId++, kind: "escalation", text: item.text, time: fmtDateTime(new Date(item.time)), escalation: { ...item.escalation } };
}

export function makeCommandEntry(item: { text: string; time: number; command: CommandInfo }): Entry {
	return { id: nextId++, kind: "command", text: item.text, time: fmtDateTime(new Date(item.time)), command: { ...item.command } };
}

export function makeShellEntry(item: { text: string; time: number; command: CommandInfo }): Entry {
	return { id: nextId++, kind: "shell", text: item.text, time: fmtDateTime(new Date(item.time)), command: { ...item.command } };
}

export function makeSkillEntry(item: { text: string; time: number; skill: CommandInfo }): Entry {
	return { id: nextId++, kind: "skill", text: item.text, time: fmtDateTime(new Date(item.time)), skill: { ...item.skill } };
}

export function makeSysEntry(text: string, error = false, aborted = false): Entry {
	return { id: nextId++, kind: "sys", text, error, ...(aborted ? { aborted: true } : {}) };
}

export function makeSepEntry(text: string): Entry {
	return { id: nextId++, kind: "sep", text };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function parseStamp(raw: string | undefined): { date: string; time: string } | null {
	const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
	if (!m) return null;
	return { date: `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`, time: `${m[4]}:${m[5]}` };
}

export function formatHistoryTime(raw: string | undefined): string {
	const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
	if (!m) return "";
	const [, year, month, day, hour, minute] = m;
	const now = new Date();
	const y = Number(year);
	const mo = Number(month);
	const d = Number(day);
	const time = `${hour}:${minute}`;
	if (y === now.getFullYear() && mo === now.getMonth() + 1 && d === now.getDate()) return time;
	const md = `${MONTHS[mo - 1]} ${d}`;
	return y === now.getFullYear() ? `${md} · ${time}` : `${md} ${y} · ${time}`;
}

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

function Markdown(props: { text: string; class?: string }) {
	let ref: HTMLDivElement | undefined;
	createEffect(() => {
		const el = ref;
		if (!el) return;

		el.innerHTML = renderMarkdownPlain(props.text);

		let observer: IntersectionObserver | undefined;
		const upgrade = () => {
			if (el.querySelector(".shiki")) return;
			el.innerHTML = renderMarkdown(props.text);
			observer?.disconnect();
		};

		if (typeof IntersectionObserver === "function") {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) upgrade();
					}
				},
				{ root: null, rootMargin: "200px" },
			);
			observer.observe(el);
		} else {
			upgrade();
		}

		onCleanup(() => observer?.disconnect());
	});
	return <div ref={ref} class={props.class} />;
}

function letterBody(card: Entry, worker?: string, showPostmark = true, rich = true) {
	const stamp = showPostmark ? parseStamp(card.time) : null;
	return (
		<>
			{stamp && (
				<div class="msg-postmark">
					<span>{stamp.date}</span>
					<span>{stamp.time}</span>
				</div>
			)}
			{rich ? <Markdown text={card.text} class="md msg-letter-text" /> : <div class="msg-letter-text">{card.text}</div>}
			{worker && (
				<div class="msg-sign">
					— {worker} · {formatHistoryTime(card.time)}
				</div>
			)}
		</>
	);
}

function escalationBody(esc: EscalationInfo, onRespond?: (id: string, approved: boolean) => void) {
	return (
		<>
			<div class="msg-escalation-head">sandbox escalation</div>
			<pre class="msg-escalation-cmd">{esc.command}</pre>
			<div class="msg-escalation-meta">
				<span>
					{esc.from} → <b>{esc.to}</b>
				</span>
				{esc.justification && <span class="msg-escalation-just">justification: {esc.justification}</span>}
			</div>
			{esc.status === "pending" ? (
				<div class="msg-escalation-actions">
					<button class="msg-escalation-btn" onClick={() => onRespond?.(esc.id, false)}>
						Reject
					</button>
					<button class="msg-escalation-btn msg-escalation-btn-approve" onClick={() => onRespond?.(esc.id, true)}>
						Approve
					</button>
				</div>
			) : (
				<div class={"msg-escalation-status" + (esc.status === "approved" ? " ok" : esc.status === "rejected" ? " no" : " drp")}>{esc.status}</div>
			)}
		</>
	);
}

const STACK_CARD_MIN_HEIGHT = 96;

const STACK_PEEK = 10;
const STACK_PEEK_STEP = 5;

const STACK_MAX_ROTATION = 2.8;

function MessageStack(props: {
	cards: Entry[];
	anchorKey: string;
	worker?: string;
	locateFlashId?: Accessor<number | null>;
	onEscalationRespond?: (id: string, approved: boolean) => void;
}) {
	const [current, setCurrent] = createSignal(props.cards.length - 1);

	let prevLen = props.cards.length;
	createEffect(() => {
		const len = props.cards.length;
		const c = current();
		if (len > prevLen) setCurrent(len - 1);
		else if (c >= len) setCurrent(len - 1);
		prevLen = len;
	});
	const prev = () => setCurrent(Math.max(0, current() - 1));
	const next = () => setCurrent(Math.min(props.cards.length - 1, current() + 1));
	return (
		<div class="msg-stack" style={{ "padding-top": `${STACK_PEEK}px` }} data-chat-anchor-key={props.anchorKey} data-chat-flow-key={props.anchorKey}>
			<For each={props.cards}>
				{(card, i) => {
					const depth = () => (current() - i() + props.cards.length) % props.cards.length;

					const layer = () => Math.min(depth(), 2);

					const peek = () => layer() * STACK_PEEK_STEP;

					const jitter = depth() <= 2 ? seededUnit(hashString(card.text)) : 0;

					const rotation = Math.max(-STACK_MAX_ROTATION, Math.min(STACK_MAX_ROTATION, (layer() % 2 ? 1 : -1) * layer() * 1.4 + jitter * 0.8));
					return (
						<div
							class={"msg-letter msg-stack-card" + (depth() === 0 ? " on-top" : "") + (props.locateFlashId?.() === card.id ? " locate-flash" : "")}
							id={"entry-" + card.id}
							style={{
								transform: depth() === 0 ? undefined : `translate(${jitter * 3}px, ${-(peek() + jitter * 2)}px) rotate(${rotation}deg)`,
								"z-index": 10 - depth(),
								...(depth() === 0 ? { "min-height": `${STACK_CARD_MIN_HEIGHT}px` } : { height: `${STACK_CARD_MIN_HEIGHT}px`, overflow: "hidden" }),
							}}
						>
							{card.kind === "escalation" && card.escalation
								? escalationBody(card.escalation, props.onEscalationRespond)
								: letterBody(card, props.worker, depth() === 0, depth() <= 2)}
						</div>
					);
				}}
			</For>
			{props.cards.length > 1 && (
				<div class="msg-stack-nav">
					<button class="msg-stack-switch" title="Previous reply" onClick={prev} disabled={current() === 0}>
						‹
					</button>
					<span class="msg-stack-count">
						{current() + 1} / {props.cards.length}
					</span>
					<button class="msg-stack-switch" title="Next reply" onClick={next} disabled={current() === props.cards.length - 1}>
						›
					</button>
				</div>
			)}
		</div>
	);
}

const blockKey = (b: Entry | Entry[]) => (Array.isArray(b) ? b[0] : b).key ?? String(Array.isArray(b) ? b[0].id : b.id);

export function Transcript(props: {
	working: Accessor<boolean>;
	historyLoading: Accessor<boolean>;
	worker?: string;
	onEscalationRespond?: (id: string, approved: boolean) => void;
}) {
	const controller = useTranscript();
	const session = useSession();
	const skillDirectory = useSkills();
	onCleanup(() => controller.detach());
	const [expandedCommand, setExpandedCommand] = createSignal<number | null>(null);
	const [skillDialog, setSkillDialog] = createSignal<{ name: string; content: string } | null>(null);
	async function inspectSkill(name: string) {
		const res = await skillDirectory.mutate.inspect(name);
		if (res.ok && res.content != null) setSkillDialog({ name, content: res.content });
	}

	return (
		<MotionConfigProvider reducedMotion="user">
			<div class="relative flex-1 min-h-0 flex flex-col">
				<section class="transcript flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3" id="transcript" aria-live="polite" ref={controller.setContainer}>
					<div class="transcript-inner">
						{controller.view().length === 0 && !props.working() && (
							<div class="text-center pt-16">
								{props.historyLoading() ? (
									<>
										<p class="font-serif text-[17px] text-ink-soft">— reading the archives… —</p>
										<p class="eyebrow mt-3">restoring the conversation from disk</p>
									</>
								) : (
									<>
										<p class="font-serif text-[17px] text-ink-soft">— waiting for your first prompt —</p>
										<p class="eyebrow mt-3">ask it to read a file, run a command, or just talk</p>
									</>
								)}
							</div>
						)}

						<Show when={session.data.origin.hasMore}>
							<div class="load-earlier-wrap">
								<button
									class="load-earlier"
									onClick={() => {
										void session.mutate.loadOlderHistory().then(() => controller.persistAnchor());
									}}
									disabled={session.data.origin.loading}
								>
									{session.data.origin.loading ? "loading…" : "↑ load earlier"}
								</button>
							</div>
						</Show>
						<For each={controller.blocks()}>
							{(block) => {
								if (Array.isArray(block)) {
									const card = block[0];
									const key = blockKey(block);

									if (block.length === 1) {
										if (card.kind === "escalation" && card.escalation) {
											return (
												<div class="msg-escalation" id={"entry-" + card.id} data-chat-anchor-key={key} data-chat-flow-key={key}>
													{escalationBody(card.escalation, props.onEscalationRespond)}
												</div>
											);
										}
										return (
											<Motion
												as="div"
												class={"msg-letter" + (controller.locateFlashId() === card.id ? " locate-flash" : "")}
												id={"entry-" + card.id}
												data-chat-anchor-key={key}
												data-chat-flow-key={key}
												initial={{ opacity: 0, scale: 0.96, rotate: 0.4 }}
												animate={{ opacity: 1, scale: 1, rotate: 0 }}
												transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
											>
												{letterBody(card, props.worker)}
											</Motion>
										);
									}
									return (
										<MessageStack cards={block} anchorKey={key} worker={props.worker} locateFlashId={controller.locateFlashId} onEscalationRespond={props.onEscalationRespond} />
									);
								}
								const e = block;
								const key = blockKey(block);
								if (e.kind === "user") {
									return (
										<>
											<Motion
												as="div"
												class={"msg-user" + (controller.locateFlashId() === e.id ? " locate-flash" : "")}
												id={"entry-" + e.id}
												data-chat-anchor-key={key}
												data-chat-flow-key={key}
												initial={{ opacity: 0, y: 6 }}
												animate={{ opacity: 1, y: 0 }}
												transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
											>
												{e.text}
											</Motion>
											<span class="msg-user-time">{formatHistoryTime(e.time)}</span>
										</>
									);
								}
								if (e.kind === "sys") {
									if (e.error) {
										return (
											<div class="sys-error" data-chat-anchor-key={key} data-chat-flow-key={key}>
												<span class="sys-error-tag">ERR</span>
												<span class="sys-error-text">{e.text}</span>
											</div>
										);
									}
									if (e.aborted) {
										return (
											<div class="sys-stopped" data-chat-anchor-key={key} data-chat-flow-key={key}>
												<CircleStop size={12} />
												<span>{e.text}</span>
											</div>
										);
									}
									return (
										<div class="sys" data-chat-anchor-key={key} data-chat-flow-key={key}>
											{e.text}
										</div>
									);
								}
								if ((e.kind === "command" || e.kind === "skill" || e.kind === "shell") && (e.command ?? e.skill)) {
									const info = e.kind === "skill" ? e.skill! : e.command!;
									const args = info.args;
									const output = info.text;
									const expandable = e.kind === "command" ? !!args : false;
									const expanded = expandedCommand() === e.id;
									return (
										<div
											class={
												"msg-command" +
												(info.status === "success" ? " ok" : "") +
												(info.status === "error" ? " is-error" : "") +
												(expandable ? " has-args" : "") +
												(expanded ? " expanded" : "") +
												(e.kind === "skill" ? " is-skill" : "") +
												(e.kind === "shell" ? " is-shell" : "")
											}
											id={"entry-" + e.id}
											data-chat-anchor-key={key}
											data-chat-flow-key={key}
											onClick={
												e.kind === "skill" ? () => void inspectSkill(info.name) : e.kind === "command" && expandable ? () => setExpandedCommand(expanded ? null : e.id) : undefined
											}
											role={e.kind === "skill" || (e.kind === "command" && expandable) ? "button" : undefined}
											aria-expanded={e.kind === "skill" ? undefined : e.kind === "command" && expandable ? expanded : undefined}
										>
											<div class="msg-command-head">
												{e.kind === "skill" ? (
													<span class="msg-command-badge">skill</span>
												) : e.kind === "shell" ? (
													<span class="msg-command-badge">shell</span>
												) : e.kind === "command" ? (
													<span class="msg-command-badge">command</span>
												) : null}
												<span class="msg-command-name">{info.name}</span>
												<span class={"msg-command-status " + info.status}>
													{info.status === "success" ? <Check size={12} /> : null}
													{info.status === "error" ? "error" : null}
													{info.status === "interrupted" ? "interrupted" : null}
													{info.status === "running" ? (
														<span class="msg-command-running">
															<span class="work-dot" />
															<span class="work-dot" />
															<span class="work-dot" />
														</span>
													) : null}
												</span>
											</div>
											{e.kind === "skill" ? (
												args ? (
													<div class="msg-command-args">{args}</div>
												) : null
											) : e.kind === "shell" ? (
												output ? (
													<div class="msg-command-args is-shell-out">{output}</div>
												) : null
											) : info.status === "error" && output ? (
												<div class="msg-command-args is-command-error">{output}</div>
											) : expanded && args ? (
												<div class="msg-command-args">{args}</div>
											) : null}
										</div>
									);
								}
								return (
									<div class="time-sep" data-chat-anchor-key={key} data-chat-flow-key={key}>
										{e.text}
									</div>
								);
							}}
						</For>

						<AnimatePresence>
							{props.working() && (
								<Motion
									as="div"
									class="msg-letter msg-speaking"
									initial={{ opacity: 0, scale: 0.97 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
								>
									<div class="msg-speaking-dots">
										<span class="work-dot" />
										<span class="work-dot" />
										<span class="work-dot" />
									</div>
									{props.worker && <div class="msg-sign">— {props.worker} is writing…</div>}
								</Motion>
							)}
						</AnimatePresence>
					</div>
				</section>

				<Show when={controller.showBackToBottom()}>
					<button class="back-to-bottom" title="Back to latest" onClick={() => controller.scrollToBottom(true)}>
						↓ latest
					</button>
				</Show>
			</div>
			<Dialog open={skillDialog() != null} onOpenChange={(open) => !open && setSkillDialog(null)}>
				<DialogContent class="w-[560px] max-w-[560px] bg-paper p-0 gap-0">
					<DialogTitle class="sr-only">{skillDialog()?.name ?? ""}</DialogTitle>
					<div class="flex max-h-[70vh] flex-col gap-3 p-5">
						<div class="font-mono text-[13px] font-medium text-ink">skill · {skillDialog()?.name}</div>
						<div class="md md-wrap-pre overflow-y-auto overflow-x-hidden" innerHTML={renderMarkdown(skillDialog()?.content ?? "")} />
					</div>
				</DialogContent>
			</Dialog>
		</MotionConfigProvider>
	);
}
