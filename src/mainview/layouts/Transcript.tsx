/**
 * Transcript — the document layer, rendered with Solid.
 * Knows nothing about RPC or the agent: it receives entries and renders them.
 * Letter conversation: a 60%-centered narrow letter column, no avatars. user = warm-ink envelope bubble + seal time;
 * agent = letter paper + dashed postmark + markdown body + signature line; running indicator = a "speaking"
 * letter bubble at the end (three ink dots + signature line); messages arriving mid-run render above it.
 */
import { type Accessor, createEffect, For } from "solid-js";
import { AnimatePresence, Motion, MotionConfigProvider } from "solid-motion";
import { renderMarkdown } from "../lib/markdown";

export interface Entry {
	id: number;
	kind: "user" | "agent" | "sys" | "sep";
	text: string;
	time?: string;
	error?: boolean;
	/** id of the persisted pi entry (carried by agent messages; used to locate the trajectory segment on click). */
	piId?: string;
}

export const SEPARATOR_GAP_MS = 5 * 60 * 1000;

let nextId = 1;
const pad = (n: number) => String(n).padStart(2, "0");
/** Full date-time format: 2026-08-13 10:22:27 */
const fmtDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export function makeUserEntry(text: string, time = Date.now(), piId?: string): Entry {
	return { id: nextId++, kind: "user", text, time: fmtDateTime(new Date(time)), piId };
}

export function makeAgentEntry(text: string, time = Date.now(), piId?: string): Entry {
	return { id: nextId++, kind: "agent", text, time: fmtDateTime(new Date(time)), piId };
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

export function Transcript(props: {
	entries: Accessor<Entry[]>;
	working: Accessor<boolean>;
	tick: Accessor<number>;
	worker?: string;
	onViewTrajectory?: (piId: string) => void;
	/** Outline locate target: the matching bubble briefly flashes seal-soft. */
	locateFlashId?: Accessor<number | null>;
	/** The agent message currently visible in the viewport (pi id), reported for trajectory linkage. */
	onVisibleReply?: (piId: string | null) => void;
}) {
	let container: HTMLElement | undefined;

	createEffect(() => {
		props.tick(); // push, history, turn, end — all bump it
		container && (container.scrollTop = container.scrollHeight);
	});

	// Trajectory linkage: report the agent message currently in the viewport (center band)
	createEffect(() => {
		const root = container;
		if (!props.onVisibleReply || !root) return;
		props.entries().length; // re-observe when entries change
		const targets = Array.from(root.querySelectorAll<HTMLElement>(".msg-letter[data-pi]"));
		if (targets.length === 0) {
			props.onVisibleReply(null);
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				let best: IntersectionObserverEntry | null = null;
				for (const en of entries) {
					if (en.isIntersecting && (!best || en.intersectionRatio > best.intersectionRatio)) best = en;
				}
				props.onVisibleReply?.((best?.target as HTMLElement | undefined)?.dataset["pi"] ?? null);
			},
			{ root, rootMargin: "-30% 0px -55% 0px" },
		);
		targets.forEach((t) => io.observe(t));
		return () => io.disconnect();
	});

	return (
		<MotionConfigProvider reducedMotion="user">
			<section class="transcript flex-1 overflow-y-auto overscroll-contain px-4 py-3" id="transcript" aria-live="polite" ref={container}>
				<div class="transcript-inner">
					{props.entries().length === 0 && !props.working() && (
						<div class="text-center pt-16">
							<p class="font-serif text-[17px] text-ink-soft">— waiting for your first prompt —</p>
							<p class="eyebrow mt-3">ask it to read a file, run a command, or just talk</p>
						</div>
					)}
					<For each={props.entries()}>
						{(e) => {
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
										<span class="msg-user-time">
											{timeHM(e.time)}
											{e.piId && props.onViewTrajectory && (
												<button class="msg-trajectory-link" title="View trajectory" onClick={() => props.onViewTrajectory?.(e.piId!)}>
													Trajectory
												</button>
											)}
										</span>
									</>
								);
							}
							if (e.kind === "agent") {
								const stamp = parseStamp(e.time);
								return (
									<Motion
										as="div"
										class={"msg-letter" + (props.locateFlashId?.() === e.id ? " locate-flash" : "")}
										id={"entry-" + e.id}
										data-pi={e.piId}
										initial={{ opacity: 0, scale: 0.96, rotate: 0.4 }}
										animate={{ opacity: 1, scale: 1, rotate: 0 }}
										transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
									>
										{stamp && (
											<div class="msg-postmark">
												<span>{stamp.date}</span>
												<span>{stamp.time}</span>
											</div>
										)}
										<div class="md msg-letter-text" innerHTML={renderMarkdown(e.text)} />
										{props.worker && (
											<div class="msg-sign">
												— {props.worker} · {timeHM(e.time)}
												{e.piId && props.onViewTrajectory && (
													<button class="msg-trajectory-link" title="View trajectory" onClick={() => props.onViewTrajectory?.(e.piId!)}>
														Trajectory
													</button>
												)}
											</div>
										)}
									</Motion>
								);
							}
							if (e.kind === "sys") {
								return <div class={e.error ? "sys sys-error" : "sys"}>{e.text}</div>;
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
