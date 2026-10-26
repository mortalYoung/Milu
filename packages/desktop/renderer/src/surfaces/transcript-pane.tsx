import { SLOT_POINTS, type SeqEntry } from "@milu/protocol";
import { type Host, type SurfaceProps, type StepGroup, type ViewItem, formatHistoryTime, layoutView, oneLine, projectView, stepSummary } from "@milu/window";
import type { MarkdownPort } from "@milu/window/markdown";
import { Markdown } from "@milu/window/markdown/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { copyPath } from "../clipboard.ts";
import { ChatBar } from "../components/chat-bar.tsx";
import { Composer } from "../components/composer.tsx";
import { ArrowDownIcon, CheckIcon, CircleStopIcon, CopyIcon } from "../components/icons.tsx";
import { TranscriptSkeleton } from "../components/skeletons.tsx";
import { Welcome } from "../components/welcome.tsx";

const NO_ENTRIES: readonly SeqEntry[] = [];
const NO_PANES: readonly never[] = [];

const hasSelection = (): boolean => window.getSelection()?.isCollapsed === false;

function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
	const next = new Set(set);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	return next;
}

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

function NoteRow(props: { row: ViewItem; port: MarkdownPort; open: boolean; working: boolean; onToggle: () => void }) {
	const { row, port } = props;
	const tool = row.tool;
	const thinking = row.thinking;
	if (row.say) {
		return (
			<div className="msg-note is-say">
				<span className="msg-note-node" />
				<span className="msg-note-kind">say</span>
				<div className="msg-note-say md msg-note-md">
					<Markdown port={port} text={row.text} />
				</div>
			</div>
		);
	}
	const failed = tool?.status === "error";
	const running = tool?.status === "running" && props.working;
	const line = tool ? tool.summary : thinking?.redacted === true ? "redacted" : oneLine(thinking?.text ?? "");
	const opens = tool ? (tool.args ?? "") !== "" || (tool.result ?? "") !== "" : thinking != null && thinking.redacted !== true && thinking.text !== "";
	return (
		<div
			className={"msg-note" + (opens ? " is-open" : "")}
			role={opens ? "button" : undefined}
			tabIndex={opens ? 0 : undefined}
			aria-expanded={opens ? props.open : undefined}
			onClick={
				opens
					? () => {
							if (hasSelection()) return;
							props.onToggle();
						}
					: undefined
			}
			onKeyDown={
				opens
					? (event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							props.onToggle();
						}
					: undefined
			}
		>
			<span className={"msg-note-node" + (running ? " is-live" : failed ? " is-fail" : tool ? " is-run" : "")} />
			<span className="msg-note-kind">{tool ? tool.name : "think"}</span>
			<span className="msg-note-sep">·</span>
			<span className="msg-note-line">{line}</span>
			{opens ? <span className="msg-note-caret">{props.open ? "⌄" : "›"}</span> : null}
			{opens && props.open ? (
				<div className="msg-note-card-wrap">
					<div className="msg-note-card" onClick={(event) => event.stopPropagation()}>
						{tool ? (
							<>
								{tool.args ? (
									<div className="msg-note-field">
										<span className="msg-note-label">args</span>
										<pre className="msg-note-pre">{tool.args}</pre>
									</div>
								) : null}
								{tool.result ? (
									<div className="msg-note-field">
										<span className="msg-note-label">{failed ? "result · failed" : "result"}</span>
										<pre className="msg-note-pre">{tool.result}</pre>
									</div>
								) : null}
							</>
						) : (
							<Markdown port={port} text={thinking?.text ?? ""} className="msg-note-md" />
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

function StepBlock(props: {
	group: StepGroup;
	port: MarkdownPort;
	working: boolean;
	live: boolean;
	open: boolean;
	onToggle: () => void;
	openRows: ReadonlySet<string>;
	onToggleRow: (key: string) => void;
}) {
	const { rows } = props.group;
	const first = rows[0];
	if (!first) return null;
	const collapsible = rows.length > 1;
	const folded = collapsible && !props.live && !props.open;
	const summary = (
		<button type="button" className="msg-step-sum" aria-expanded={!folded} onClick={props.onToggle}>
			<span className="msg-note-caret">{folded ? "›" : "⌄"}</span>
			{stepSummary(rows).map((part, index) => (
				<span key={part.text}>
					{index > 0 ? <span className="msg-note-sep">·</span> : null}
					<span className={part.fail ? "msg-step-fail" : undefined}>{part.text}</span>
				</span>
			))}
		</button>
	);
	return (
		<div className="msg-step">
			{collapsible && !props.live ? summary : null}
			{folded ? null : (
				<div className="msg-step-scroll">
					<div className="msg-step-rows">
						{rows.map((row) => (
							<NoteRow key={row.id} row={row} port={props.port} open={props.openRows.has(row.id)} working={props.working} onToggle={() => props.onToggleRow(row.id)} />
						))}
					</div>
				</div>
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
	const tail = items.length > 0 ? items[items.length - 1] : undefined;

	const panes = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatPanes] ?? NO_PANES);
	const focused = useStore(host.transcript.store, (state) => state.focused);

	const [openSteps, setOpenSteps] = useState<ReadonlySet<string>>(() => new Set());
	const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
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
									{display.map((row) => {
										if ("step" in row) {
											const live = working && tail !== undefined && row.step.rows.some((item) => item.id === tail.id);
											return (
												<StepBlock
													key={`s:${row.step.key}`}
													group={row.step}
													port={host.markdown}
													working={working}
													live={live}
													open={openSteps.has(row.step.key)}
													onToggle={() => setOpenSteps((previous) => toggle(previous, row.step.key))}
													openRows={openRows}
													onToggleRow={(key) => setOpenRows((previous) => toggle(previous, key))}
												/>
											);
										}
										const item = row.item;
										if (item.kind === "sep") {
											return (
												<div key={`i:${item.id}`} className="time-sep">
													{item.text}
												</div>
											);
										}
										if (item.kind === "escalation") {
											return <EscalationCard key={`i:${item.id}`} item={item} host={host} session={selected} />;
										}
										if (item.kind === "error") {
											return (
												<div key={`i:${item.id}`} className="sys-error" data-entry={item.id}>
													<span className="sys-error-tag">ERR</span>
													<span className="sys-error-text">{item.text}</span>
												</div>
											);
										}
										if (item.kind === "aborted") {
											return (
												<div key={`i:${item.id}`} className="sys-stopped" data-entry={item.id}>
													<CircleStopIcon size={12} />
													<span>{item.text}</span>
												</div>
											);
										}
										if (item.kind === "shell") {
											return <ShellBlock key={`i:${item.id}`} item={item} />;
										}
										if (item.kind === "user") {
											return item.peerKind === "reply" ? <ReplyCard key={`i:${item.id}`} item={item} port={host.markdown} /> : <UserBubble key={`i:${item.id}`} item={item} />;
										}
										return (
											<div key={`i:${item.id}`} className="msg-block msg-block-agent" data-entry={item.id}>
												<Markdown port={host.markdown} text={item.text} className="msg-body" />
												<div className="msg-meta">
													<CopyButton text={item.text} />
													<span className="msg-at">{formatHistoryTime(item.time)}</span>
													{item.to ? <span className="msg-chip">→ {item.to}</span> : null}
												</div>
											</div>
										);
									})}
									{working ? (
										<div className="msg-block msg-speaking">
											<div className="msg-speaking-dots">
												<span className="work-dot" />
												<span className="work-dot" />
												<span className="work-dot" />
											</div>
										</div>
									) : null}
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
