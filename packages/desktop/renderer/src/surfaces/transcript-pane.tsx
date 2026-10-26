import { SLOT_POINTS, type SeqEntry } from "@milu/protocol";
import { type DisplayRow, type Host, type SurfaceProps, type ViewItem, formatHistoryTime, layoutView, liveRowsOf, projectView } from "@milu/window";
import type { MarkdownPort } from "@milu/window/markdown";
import { Markdown } from "@milu/window/markdown/react";
import { createElement, memo, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { copyPath } from "../clipboard.ts";
import { ChatBar } from "../components/chat-bar.tsx";
import { Composer } from "../components/composer.tsx";
import { ArrowDownIcon, CheckIcon, CircleStopIcon, CopyIcon } from "../components/icons.tsx";
import { TranscriptSkeleton } from "../components/skeletons.tsx";
import { Welcome } from "../components/welcome.tsx";

const NO_ENTRIES: readonly SeqEntry[] = [];
const NO_PANES: readonly never[] = [];
const NO_ROWS: readonly DisplayRow[] = [];

function CopyButton(props: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className={copied ? "msg-copy copied" : "msg-copy"}
			aria-label={copied ? "Copied" : "Copy message"}
			onClick={() => {
				void copyPath(props.text);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
		</button>
	);
}

function UserBubble(props: { item: ViewItem }) {
	const schedule = props.item.schedule;
	return (
		<div className="msg-block msg-block-user" data-entry={props.item.id}>
			{schedule ? (
				<div className="msg-origin">
					<span className="msg-origin-badge">scheduled</span>
					<span className="msg-origin-title">{schedule.title}</span>
					<span className="msg-origin-when">{schedule.trigger === "manual" ? "manual" : "on time"}</span>
					{schedule.status ? <span className={"msg-origin-status is-" + schedule.status}>{schedule.status === "dispatched" ? "sent" : schedule.status}</span> : null}
					{schedule.error ? <span className="msg-origin-error">{schedule.error}</span> : null}
				</div>
			) : null}
			<div className="msg-user read-clamp">{props.item.text}</div>
			<div className="msg-meta">
				<span className="msg-at">{formatHistoryTime(props.item.time)}</span>
				{props.item.from ? <span className="msg-chip">from {props.item.from}</span> : null}
			</div>
		</div>
	);
}

function ReplyCard(props: { item: ViewItem; port: MarkdownPort }) {
	return (
		<div className="msg-reply" data-entry={props.item.id}>
			<div className="msg-reply-head">
				<span className="msg-reply-stamp">
					{props.item.from} · {formatHistoryTime(props.item.time)}
				</span>
				<CopyButton text={props.item.text} />
			</div>
			<div className="msg-reply-body read-clamp">
				<Markdown port={props.port} text={props.item.text} />
			</div>
		</div>
	);
}

function EscalationCard(props: { item: ViewItem; host: Host; session: string }) {
	const escalation = props.item.escalation;
	if (!escalation) return null;
	const tone = escalation.status === "approved" ? " ok" : escalation.status === "rejected" ? " no" : " drp";
	const answer = (approved: boolean): void => {
		void props.host.actions.invoke("permission.answer", props.session, { escalationId: escalation.id, approved }).catch((error: unknown) => {
			props.host.transcript.fail(props.session, error instanceof Error ? error.message : String(error));
		});
	};
	return (
		<div className="msg-escalation" data-entry={props.item.id}>
			<div className="msg-escalation-head">sandbox escalation</div>
			<pre className="msg-escalation-cmd">{escalation.command}</pre>
			<div className="msg-escalation-meta">
				<span>
					{escalation.from} → <b>{escalation.to}</b>
				</span>
				{escalation.justification ? <span className="msg-escalation-just">justification: {escalation.justification}</span> : null}
			</div>
			{escalation.status === "pending" ? (
				<div className="msg-escalation-actions">
					<button type="button" className="conv-dialog-button" onClick={() => answer(true)}>
						Approve
					</button>
					<button type="button" className="conv-dialog-button" onClick={() => answer(false)}>
						Deny
					</button>
				</div>
			) : (
				<div className={"msg-escalation-status" + tone}>{escalation.status}</div>
			)}
		</div>
	);
}

function ShellBlock(props: { item: ViewItem }) {
	const [open, setOpen] = useState(true);
	const shell = props.item.shell;
	const failed = shell?.exitCode !== undefined && shell.exitCode !== 0;
	return (
		<div className="msg-block" data-entry={props.item.id}>
			<button type="button" className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className={`rounded px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase ${failed ? "bg-signal/10 text-signal" : "bg-hover text-muted"}`}>shell</span>
				<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">$ {props.item.text}</span>
				{failed ? <span className="shrink-0 font-mono text-[10px] text-signal">exit {shell?.exitCode}</span> : null}
				<span className="shrink-0 font-mono text-[10px] text-muted">{open ? "−" : "+"}</span>
			</button>
			{open && shell && shell.output !== "" ? (
				<pre className="mt-1.5 mb-0 max-h-[320px] overflow-auto rounded-md border border-line bg-code-block-bg px-3 py-2 font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words text-ink">
					{shell.output}
				</pre>
			) : null}
		</div>
	);
}

function AssistantBlock(props: { host: Host; item: ViewItem; live?: boolean }) {
	return (
		<div className={props.live ? "msg-block msg-block-agent is-live" : "msg-block msg-block-agent"} data-entry={props.item.id}>
			<Markdown port={props.host.markdown} text={props.item.text} className="msg-body" plain={props.live} />
			<div className={props.live ? "msg-meta invisible" : "msg-meta"}>
				<CopyButton text={props.item.text} />
				<span className="msg-at">{formatHistoryTime(props.item.time)}</span>
				{props.item.to ? <span className="msg-chip">→ {props.item.to}</span> : null}
			</div>
		</div>
	);
}

const TranscriptRow = memo(function TranscriptRow(props: { host: Host; session: string; item: ViewItem }) {
	const { host, session, item } = props;
	if (item.kind === "sep") return <div className="time-sep">{item.text}</div>;
	if (item.kind === "escalation") return <EscalationCard item={item} host={host} session={session} />;
	if (item.kind === "error")
		return (
			<div className="sys-error" data-entry={item.id}>
				<span className="sys-error-tag">ERR</span>
				<span className="sys-error-text">{item.text}</span>
			</div>
		);
	if (item.kind === "aborted")
		return (
			<div className="sys-stopped" data-entry={item.id}>
				<CircleStopIcon size={12} />
				<span>{item.text}</span>
			</div>
		);
	if (item.kind === "shell") return <ShellBlock item={item} />;
	if (item.kind === "user") return item.peerKind === "reply" ? <ReplyCard item={item} port={host.markdown} /> : <UserBubble item={item} />;
	return <AssistantBlock host={host} item={item} />;
});

function SpeakingDots() {
	return (
		<div className="msg-block msg-speaking">
			<div className="msg-speaking-dots">
				<span className="work-dot" />
				<span className="work-dot" />
				<span className="work-dot" />
			</div>
		</div>
	);
}

/** The one component that re-renders while a reply streams; the rows behind it stay put. */
function StreamTail(props: { host: Host; session: string; working: boolean; headed: boolean }) {
	const message = useStore(props.host.transcript.store, (state) => state.partials[props.session] ?? null);
	const started = useStore(props.host.transcript.store, (state) => state.started[props.session] ?? 0);
	const rows = useMemo(() => (message ? liveRowsOf(message, started) : NO_ROWS), [message, started]);
	if (!props.working) return null;
	if (rows.length === 0) return <SpeakingDots />;
	const Step = props.host.rows.get("step");
	return (
		<>
			{rows.map((row) =>
				"step" in row ? (
					Step && <Step key={`s:${row.step.key}`} host={props.host} data={{ group: row.step, live: true, header: props.headed }} />
				) : (
					<AssistantBlock key={`i:${row.item.id}`} host={props.host} item={row.item} live />
				),
			)}
		</>
	);
}

export function TranscriptPaneSurface(props: SurfaceProps) {
	const { host } = props;

	const selected = useStore(host.selection.store, (state) => state.selected);
	const components = useStore(host.slots.store, (state) => state.components);
	const loading = useStore(host.transcript.store, (state) => state.loading[selected] ?? false);
	const entries = useStore(host.transcript.store, (state) => state.logs[selected] ?? NO_ENTRIES);
	const loadError = useStore(host.transcript.store, (state) => state.errors[selected] ?? "");
	const runError = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === selected)?.error ?? "");
	const error = loadError || runError;
	const working = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === selected)?.running ?? false);

	const items = useMemo(() => projectView(entries.map((seq) => seq.entry)), [entries]);
	const display = useMemo(() => layoutView(items), [items]);

	const panes = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatPanes] ?? NO_PANES);
	const focused = useStore(host.transcript.store, (state) => state.focused);

	const [following, setFollowing] = useState(true);
	const [followed, setFollowed] = useState(selected);
	if (followed !== selected) {
		setFollowed(selected);
		setFollowing(true);
	}

	const scroll = useRef<HTMLDivElement>(null);
	const locating = useRef(false);

	useEffect(() => {
		if (!following) return;
		const element = scroll.current;
		if (!element) return;
		const pin = () => {
			element.scrollTop = element.scrollHeight;
		};
		pin();
		const frame = requestAnimationFrame(pin);
		const settle = window.setTimeout(pin, 160);
		const resize = new ResizeObserver(pin);
		resize.observe(element);
		for (const child of Array.from(element.children)) resize.observe(child);
		const mutations = new MutationObserver(pin);
		mutations.observe(element, { subtree: true, childList: true, characterData: true });
		void document.fonts?.ready.then(pin);
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(settle);
			resize.disconnect();
			mutations.disconnect();
		};
	}, [display, following, selected]);

	const hasMore = useStore(host.transcript.store, (state) => state.hasMore[selected] ?? false);
	const loadingOlder = useStore(host.transcript.store, (state) => state.loadingOlder[selected] ?? false);
	const loadOlder = () => {
		setFollowing(false);
		const element = scroll.current;
		const before = element?.scrollHeight ?? 0;
		void host.transcript.loadOlder(selected).then(() => {
			if (!element) return;
			element.scrollTop += element.scrollHeight - before;
		});
	};

	useEffect(() => {
		if (!focused) return;
		const element = scroll.current?.querySelector(`[data-entry="${CSS.escape(focused.id)}"]`);
		if (!element) return;
		setFollowing(false);
		locating.current = true;
		element.scrollIntoView({ block: "center", behavior: "smooth" });
		element.classList.add("is-located");
		const release = () => {
			locating.current = false;
		};
		const scroller = scroll.current;
		scroller?.addEventListener("scrollend", release, { once: true });
		const timers = [window.setTimeout(() => element.classList.remove("is-located"), 1400), window.setTimeout(release, 1200)];
		return () => {
			locating.current = false;
			element.classList.remove("is-located");
			scroller?.removeEventListener("scrollend", release);
			for (const timer of timers) window.clearTimeout(timer);
		};
	}, [focused]);

	const onScroll = () => {
		if (locating.current) return;
		const element = scroll.current;
		if (!element) return;
		const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
		setFollowing((previous) => (previous === atBottom ? previous : atBottom));
	};

	return (
		<div className="transcript-pane">
			<ChatBar host={host} />

			<div className="chat-body">
				{selected === "" ? (
					<div className="chat-main">
						<Welcome host={host} />
					</div>
				) : (
					<div className="chat-column">
						<div className="transcript-view">
							<div className="transcript" ref={scroll} onScroll={onScroll}>
								<div className="transcript-inner">
									{hasMore ? (
										<div className="load-earlier-wrap">
											<button type="button" className="load-earlier" onClick={loadOlder} disabled={loadingOlder}>
												{loadingOlder ? "loading…" : "↑ load earlier"}
											</button>
										</div>
									) : null}
									{display.length === 0 ? (
										loading ? (
											<TranscriptSkeleton />
										) : working ? null : (
											<div className="pt-16 text-center">
												<p className="m-0 font-serif text-[16px] text-ink-soft">— waiting for your first prompt —</p>
												<p className="mt-3 font-sans text-[11.5px] font-medium tracking-[0.6px] text-muted-soft uppercase">ask it to read a file, run a command, or just talk</p>
											</div>
										)
									) : null}
									{display.map((row, index) => {
										if ("step" in row) {
											const Step = host.rows.get("step");
											return Step ? createElement(Step, { key: `s:${row.step.key}`, host, data: { group: row.step, live: working && index === display.length - 1 } }) : null;
										}
										return <TranscriptRow key={`i:${row.item.id}`} host={host} session={selected} item={row.item} />;
									})}
									<StreamTail host={host} session={selected} working={working} headed={display.length === 0 || !("step" in display[display.length - 1]!)} />
									{error ? (
										<div className="sys-error">
											<span className="sys-error-tag">ERR</span>
											<span className="sys-error-text">{error}</span>
										</div>
									) : null}
								</div>
							</div>
							{following ? null : (
								<button type="button" className="back-to-bottom" aria-label="Back to latest" onClick={() => setFollowing(true)}>
									<ArrowDownIcon size={13} />
								</button>
							)}
						</div>

						<div className="composer-slot">
							<Composer host={host} />
						</div>
					</div>
				)}
			</div>

			{panes.map((item) => {
				const Component = components.get(item.component);
				return Component ? <Component key={item.id} host={host} /> : null;
			})}
		</div>
	);
}
