import { type MarkdownPort, type SurfaceProps, type StepGroup, type ViewItem, formatHistoryTime, layoutView, oneLine, projectView, stepSummary } from "@milu/client";
import { Markdown } from "@milu/markdown/react";
import type { SeqEntry } from "@milu/protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { copyPath } from "../clipboard.ts";
import { ChatBar } from "../components/chat-bar.tsx";
import { Composer } from "../components/composer.tsx";
import { ArrowDownIcon, CheckIcon, CircleStopIcon, CopyIcon } from "../components/icons.tsx";
import { useStore } from "../use-store.ts";

const NO_ENTRIES: readonly SeqEntry[] = [];

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
	return (
		<div className="msg-block msg-block-user">
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
		<div className="msg-reply">
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

function EscalationCard(props: { item: ViewItem }) {
	const escalation = props.item.escalation;
	if (!escalation) return null;
	const tone = escalation.status === "approved" ? " ok" : escalation.status === "rejected" ? " no" : " drp";
	return (
		<div className="msg-escalation">
			<div className="msg-escalation-head">sandbox escalation</div>
			<pre className="msg-escalation-cmd">{escalation.command}</pre>
			<div className="msg-escalation-meta">
				<span>
					{escalation.from} → <b>{escalation.to}</b>
				</span>
				{escalation.justification ? <span className="msg-escalation-just">justification: {escalation.justification}</span> : null}
			</div>
			<div className={"msg-escalation-status" + tone}>{escalation.status}</div>
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

export function TranscriptPaneSurface(props: SurfaceProps) {
	const { host } = props;
	const state = useStore(host.transcript.state);

	const selected = state.selected;
	const entries = state.logs[selected] ?? NO_ENTRIES;
	const error = state.errors[selected] ?? "";
	const working = state.running[selected] ?? false;

	const items = useMemo(() => projectView(entries.map((seq) => seq.entry)), [entries]);
	const display = useMemo(() => layoutView(items), [items]);
	const tail = items.length > 0 ? items[items.length - 1] : undefined;

	const [openSteps, setOpenSteps] = useState<ReadonlySet<string>>(() => new Set());
	const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
	const [following, setFollowing] = useState(true);
	const [followed, setFollowed] = useState(selected);
	if (followed !== selected) {
		setFollowed(selected);
		setFollowing(true);
	}

	const scroll = useRef<HTMLDivElement>(null);

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
	}, [display, following]);

	const hasMore = state.hasMore[selected] ?? false;
	const loadingOlder = state.loadingOlder[selected] ?? false;
	const loadOlder = () => {
		setFollowing(false);
		const element = scroll.current;
		const before = element?.scrollHeight ?? 0;
		void host.transcript.loadOlder(selected).then(() => {
			if (!element) return;
			element.scrollTop += element.scrollHeight - before;
		});
	};

	const onScroll = () => {
		const element = scroll.current;
		if (!element) return;
		const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
		setFollowing((previous) => (previous === atBottom ? previous : atBottom));
	};

	return (
		<div className="transcript-pane">
			<ChatBar host={host} />

			<div className="chat-body">
				<div className="chat-column">
					<div className="transcript-view">
						<div className="transcript" ref={scroll} onScroll={onScroll}>
							{hasMore ? (
								<div className="load-earlier-wrap">
									<button type="button" className="load-earlier" onClick={loadOlder} disabled={loadingOlder}>
										{loadingOlder ? "loading…" : "↑ load earlier"}
									</button>
								</div>
							) : null}
							{display.length === 0 ? <p className="empty">Send something.</p> : null}
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
									return <EscalationCard key={`i:${item.id}`} item={item} />;
								}
								if (item.kind === "error") {
									return (
										<div key={`i:${item.id}`} className="sys-error">
											<span className="sys-error-tag">ERR</span>
											<span className="sys-error-text">{item.text}</span>
										</div>
									);
								}
								if (item.kind === "aborted") {
									return (
										<div key={`i:${item.id}`} className="sys-stopped">
											<CircleStopIcon size={12} />
											<span>{item.text}</span>
										</div>
									);
								}
								if (item.kind === "user") {
									return item.peerKind === "reply" ? <ReplyCard key={`i:${item.id}`} item={item} port={host.markdown} /> : <UserBubble key={`i:${item.id}`} item={item} />;
								}
								return (
									<div key={`i:${item.id}`} className="msg-block msg-block-agent">
										<Markdown port={host.markdown} text={item.text} className="msg-body" />
										<div className="msg-meta">
											<CopyButton text={item.text} />
											<span className="msg-at">{formatHistoryTime(item.time)}</span>
											{item.to ? <span className="msg-chip">→ {item.to}</span> : null}
										</div>
									</div>
								);
							})}
							{error ? (
								<div className="sys-error">
									<span className="sys-error-tag">ERR</span>
									<span className="sys-error-text">{error}</span>
								</div>
							) : null}
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
			</div>
		</div>
	);
}
