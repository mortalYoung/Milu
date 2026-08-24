/**
 * Transcript — the document layer, rendered with Solid.
 * Knows nothing about RPC or the agent: it receives entries and renders them.
 * Letter conversation: a 60%-centered narrow letter column, no avatars. user = warm-ink envelope bubble + seal time;
 * agent = letter paper + dashed postmark + markdown body + signature line; running indicator = a "speaking"
 * letter bubble at the end (three ink dots + signature line); messages arriving mid-run render above it.
 */
import { type Accessor, createEffect, createMemo, createSignal, For } from "solid-js";
import { AnimatePresence, Motion, MotionConfigProvider } from "solid-motion";
import type { EscalationStatus, SandboxMode } from "../../shared/rpc";
import { renderMarkdown } from "../lib/markdown";

/** Sandbox escalation approval (kind "escalation"): the request payload + decision status. */
export interface EscalationInfo {
	id: string;
	command: string;
	from: SandboxMode;
	to: SandboxMode;
	justification: string;
	status: EscalationStatus;
}

export interface Entry {
	id: number;
	kind: "user" | "agent" | "sys" | "sep" | "escalation";
	text: string;
	time?: string;
	error?: boolean;
	escalation?: EscalationInfo;
}

let nextId = 1;
const pad = (n: number) => String(n).padStart(2, "0");
/** Full date-time format: 2026-08-13 10:22:27 */
const fmtDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export function makeUserEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "user", text, time: fmtDateTime(new Date(time)) };
}

export function makeAgentEntry(text: string, time = Date.now()): Entry {
	return { id: nextId++, kind: "agent", text, time: fmtDateTime(new Date(time)) };
}

/** Build an escalation entry from the persisted history item (status flips as a decision lands). */
export function makeEscalationEntry(item: { text: string; time: number; escalation: EscalationInfo }): Entry {
	return { id: nextId++, kind: "escalation", text: item.text, time: fmtDateTime(new Date(item.time)), escalation: { ...item.escalation } };
}

export function makeSysEntry(text: string, error = false): Entry {
	return { id: nextId++, kind: "sys", text, error };
}

export function makeSepEntry(text: string): Entry {
	return { id: nextId++, kind: "sep", text };
}

/** Parse "2026-08-13 10:22:27" → postmark "OCT 13" / "10:22" */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function parseStamp(raw: string | undefined): { date: string; time: string } | null {
	const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
	if (!m) return null;
	return { date: `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`, time: `${m[4]}:${m[5]}` };
}

/** 24-hour clock: 10:22:27 → "10:22" */
function timeHM(raw: string | undefined): string {
	const m = raw?.match(/ (\d{2}):(\d{2}):/);
	if (!m) return "";
	return `${m[1]}:${m[2]}`;
}

/** Deterministic pseudo-random in [-1, 1] from a seed — stable across re-renders and navigation. */
function seededUnit(seed: number): number {
	const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
	return (x - Math.floor(x)) * 2 - 1;
}

/** A letter's body: postmark + markdown + signature line (shared by single replies and stack cards). */
function letterBody(card: Entry, worker?: string, showPostmark = true) {
	const stamp = showPostmark ? parseStamp(card.time) : null;
	return (
		<>
			{stamp && (
				<div class="msg-postmark">
					<span>{stamp.date}</span>
					<span>{stamp.time}</span>
				</div>
			)}
			<div class="md msg-letter-text" innerHTML={renderMarkdown(card.text)} />
			{worker && (
				<div class="msg-sign">
					— {worker} · {timeHM(card.time)}
				</div>
			)}
		</>
	);
}

/** An escalation card's body: request head + command + mode change + status or Approve/Reject (shared by single bubbles and stack cards). No postmark. */
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

/**
 * Reply deck: consecutive agent replies and sandbox escalations stack like the motion.dev
 * card-stack — the newest card sits on top, the others peek translated/rotated behind it;
 * the button below cycles the deck. CSS-only (no drag); signal reads live in JSX expressions,
 * never hoisted to callback locals. Cards get a minimum height so short cards keep a
 * substantial deck; back cards are clipped to that height so the deck's bottom edges stay
 * even regardless of content. Letter cards postmark on the top card; escalation cards never.
 */
const STACK_CARD_MIN_HEIGHT = 96;
/** Reserved strip above the front card where the back cards' top edges peek out. */
const STACK_PEEK = 10;
const STACK_PEEK_STEP = 5;

function MessageStack(props: { cards: Entry[]; worker?: string; locateFlashId?: Accessor<number | null>; onEscalationRespond?: (id: string, approved: boolean) => void }) {
	const [current, setCurrent] = createSignal(props.cards.length - 1);
	// A growing deck (replies arriving mid-run) jumps to the newest card; a shrinking one clamps.
	// Only react to LENGTH changes — never to the user's own navigation, which moves `current`
	// without changing the length and would otherwise be snapped straight back to the newest card.
	let prevLen = props.cards.length;
	createEffect(() => {
		const len = props.cards.length;
		const c = current();
		if (len > prevLen)
			setCurrent(len - 1); // grew → jump to the newest card
		else if (c >= len) setCurrent(len - 1); // shrank → clamp to the newest valid index
		prevLen = len;
	});
	const prev = () => setCurrent(Math.max(0, current() - 1));
	const next = () => setCurrent(Math.min(props.cards.length - 1, current() + 1));
	return (
		<div class="msg-stack" style={{ "padding-top": `${STACK_PEEK}px` }}>
			<For each={props.cards}>
				{(card, i) => {
					// Depth relative to the top card: 0 = visible, 1 = first behind, …
					const depth = () => (i() - current() + props.cards.length) % props.cards.length;
					// Back cards lift UP into the peek strip (capped at two visible edges)
					const peek = () => Math.min(depth(), STACK_PEEK / STACK_PEEK_STEP) * STACK_PEEK_STEP;
					// Stable per-card randomness (seeded by the entry id): a slight organic jitter in
					// lift (peek), angle (rotation) and horizontal spread (depth feel) — never flickers
					// on navigation or when the deck grows.
					const jitter = seededUnit(card.id);
					return (
						<div
							class={"msg-letter msg-stack-card" + (depth() === 0 ? " on-top" : "") + (props.locateFlashId?.() === card.id ? " locate-flash" : "")}
							id={"entry-" + card.id}
							style={{
								transform:
									depth() === 0 ? undefined : `translate(${jitter * 3}px, ${-(peek() + jitter * 2)}px) rotate(${(depth() % 2 ? 1 : -1) * depth() * 1.4 + jitter * 0.8}deg)`,
								"z-index": 10 - depth(),
								...(depth() === 0 ? { "min-height": `${STACK_CARD_MIN_HEIGHT}px` } : { height: `${STACK_CARD_MIN_HEIGHT}px`, overflow: "hidden" }),
							}}
						>
							{card.kind === "escalation" && card.escalation ? escalationBody(card.escalation, props.onEscalationRespond) : letterBody(card, props.worker, depth() === 0)}
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

export function Transcript(props: {
	entries: Accessor<Entry[]>;
	working: Accessor<boolean>;
	tick: Accessor<number>;
	/** True while persisted history is being (re)read — show the archives placeholder instead of the empty prompt. */
	historyLoading: Accessor<boolean>;
	worker?: string;
	/** Outline locate target: the matching bubble briefly flashes seal-soft. */
	locateFlashId?: Accessor<number | null>;
	/** Respond to a pending sandbox escalation (inline Approve/Reject buttons). */
	onEscalationRespond?: (id: string, approved: boolean) => void;
}) {
	let container: HTMLElement | undefined;

	createEffect(() => {
		props.tick(); // push, history, turn, end — all bump it
		container && (container.scrollTop = container.scrollHeight);
	});

	// Consecutive agent replies and sandbox escalations group into one deck per burst; user/sys/sep stay standalone
	const blocks = createMemo(() => {
		const out: (Entry | Entry[])[] = [];
		let stack: Entry[] | null = null;
		for (const e of props.entries()) {
			if (e.kind === "agent" || e.kind === "escalation") {
				(stack ??= []).push(e);
			} else {
				if (stack) {
					out.push(stack);
					stack = null;
				}
				out.push(e);
			}
		}
		if (stack) out.push(stack);
		return out;
	});

	return (
		<MotionConfigProvider reducedMotion="user">
			<section class="transcript flex-1 overflow-y-auto overscroll-contain px-4 py-3" id="transcript" aria-live="polite" ref={container}>
				<div class="transcript-inner">
					{props.entries().length === 0 && !props.working() && (
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
					<For each={blocks()}>
						{(block) => {
							if (Array.isArray(block)) {
								const card = block[0];
								// One card stays standalone (a lone letter keeps its plain motion); several stack into a deck
								if (block.length === 1) {
									if (card.kind === "escalation" && card.escalation) {
										return (
											<div class="msg-escalation" id={"entry-" + card.id}>
												{escalationBody(card.escalation, props.onEscalationRespond)}
											</div>
										);
									}
									return (
										<Motion
											as="div"
											class={"msg-letter" + (props.locateFlashId?.() === card.id ? " locate-flash" : "")}
											id={"entry-" + card.id}
											initial={{ opacity: 0, scale: 0.96, rotate: 0.4 }}
											animate={{ opacity: 1, scale: 1, rotate: 0 }}
											transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
										>
											{letterBody(card, props.worker)}
										</Motion>
									);
								}
								return <MessageStack cards={block} worker={props.worker} locateFlashId={props.locateFlashId} onEscalationRespond={props.onEscalationRespond} />;
							}
							const e = block;
							if (e.kind === "user") {
								return (
									<>
										<Motion
											as="div"
											class={"msg-user" + (props.locateFlashId?.() === e.id ? " locate-flash" : "")}
											id={"entry-" + e.id}
											initial={{ opacity: 0, y: 6 }}
											animate={{ opacity: 1, y: 0 }}
											transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
										>
											{e.text}
										</Motion>
										<span class="msg-user-time">{timeHM(e.time)}</span>
									</>
								);
							}
							if (e.kind === "sys") {
								if (e.error) {
									return (
										<div class="sys-error">
											<span class="sys-error-tag">ERR</span>
											<span class="sys-error-text">{e.text}</span>
										</div>
									);
								}
								return <div class="sys">{e.text}</div>;
							}
							return <div class="time-sep">{e.text}</div>;
						}}
					</For>
					{/* Speaking: the letter bubble renders at the end; messages arriving mid-run are appended to entries and naturally appear above it */}
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
		</MotionConfigProvider>
	);
}
