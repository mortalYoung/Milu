import { SLOT_POINTS, type SeqEntry } from "@milu/protocol";
import { type DisplayRow, type Host, type SurfaceProps, type ViewItem, layoutView, liveRowsOf, projectView } from "@milu/window";
import { AgentMessage, PeerMessage, UserMessage } from "@milu/window/api/messages";
import { createElement, memo, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { mark } from "../boot.ts";
import { ChatBar } from "../components/chat-bar.tsx";
import { Composer } from "../components/composer.tsx";
import { ArrowDownIcon } from "../components/icons.tsx";
import { TranscriptSkeleton } from "../components/skeletons.tsx";
import { Welcome } from "../components/welcome.tsx";
import { TranscriptScroll } from "../scroll-follower.ts";
import { useMarkdownEnv } from "./markdown-env.ts";

const NO_ENTRIES: readonly SeqEntry[] = [];
const STEP_NARROW = 560;
const NO_PANES: readonly never[] = [];
const NO_ROWS: readonly DisplayRow[] = [];

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

function AssistantBlock(props: { host: Host; session: string; item: ViewItem; live?: boolean }) {
	const env = useMarkdownEnv(props.host, props.session, props.item.text, props.item.files);
	return <AgentMessage host={props.host} item={props.item} env={env} live={props.live} />;
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
				<span>{item.text}</span>
			</div>
		);
	if (item.kind === "user") return item.from ? <PeerMessage host={host} item={item} port={host.markdown} /> : <UserMessage host={host} session={session} item={item} />;
	const Row = host.rows.get(item.kind);
	if (Row) return createElement(Row, { host, data: { item } });
	return <AssistantBlock host={host} session={session} item={item} />;
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

function StreamTail(props: {
	host: Host;
	session: string;
	working: boolean;
	mergeFirstStep: boolean;
	onStepOpenChange?: (open: boolean) => void;
	onAlign?: (element: HTMLElement) => void;
}) {
	const message = useStore(props.host.transcript.store, (state) => state.partials[props.session] ?? null);
	const started = useStore(props.host.transcript.store, (state) => state.started[props.session] ?? 0);
	const rows = useMemo(() => (message ? liveRowsOf(message, started) : NO_ROWS), [message, started]);
	if (!props.working) return null;
	if (rows.length === 0) return props.mergeFirstStep ? null : <SpeakingDots />;
	const merged = props.mergeFirstStep && "step" in rows[0]!;
	const shown = merged ? rows.slice(1) : rows;
	if (shown.length === 0) return null;
	const Step = props.host.rows.get("step");
	return (
		<>
			{shown.map((row) =>
				"step" in row ? (
					Step && <Step key={`s:${row.step.key}`} host={props.host} data={{ group: row.step, live: true, onOpenChange: props.onStepOpenChange, onAlign: props.onAlign }} />
				) : (
					<AssistantBlock key={`i:${row.item.id}`} host={props.host} session={props.session} item={row.item} live />
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
	const workspace = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === selected)?.workspace ?? null);

	const log = useMemo(() => entries.map((seq) => seq.entry), [entries]);
	const items = useMemo(() => projectView(log, { baseDir: workspace }), [log, workspace]);
	const display = useMemo(() => layoutView(items), [items]);
	const mergeFirstStep = display.length > 0 && "step" in display[display.length - 1]!;
	const lastStepOpen = useStore(host.transcript.store, (state) => state.stepOpen[selected]);
	let lastStepIndex = -1;
	for (let index = display.length - 1; index >= 0; index -= 1) {
		const row = display[index];
		if (row !== undefined && "step" in row) {
			lastStepIndex = index;
			break;
		}
	}
	const currentStepIndex = lastStepIndex;

	const panes = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatPanes] ?? NO_PANES);
	const focused = useStore(host.transcript.store, (state) => state.focused);

	const view = useStore(host.workbench.store, (state) => state.view);
	const viewItems = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.workspaceViews] ?? NO_PANES);
	const viewComponents = useStore(host.slots.store, (state) => state.components);

	const scroll = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLDivElement>(null);
	const locating = useRef(false);
	const [follower] = useState(() => new TranscriptScroll());
	const following = useStore(follower.store, (state) => state.following);
	const alignStep = (element: HTMLElement): void => follower.alignTo(element);
	useEffect(() => {
		const scroller = scroll.current;
		const content = inner.current;
		if (scroller && content) {
			follower.attach(scroller, content, locating);
			follower.pin(true);
		}
		return () => follower.detach();
	}, [follower, selected, view]);

	useEffect(() => {
		if (view !== null) return;
		follower.pin(true);
	}, [follower, view]);

	const hasData = display.length > 0;
	useEffect(() => {
		if (!hasData) return;
		mark("data");
	}, [hasData]);

	const [narrow, setNarrow] = useState(false);
	useEffect(() => {
		const element = scroll.current;
		if (element === null) return;
		const observer = new ResizeObserver(() => setNarrow(element.clientWidth < STEP_NARROW));
		observer.observe(element);
		return () => observer.disconnect();
	}, [view]);

	const hasMore = useStore(host.transcript.store, (state) => state.hasMore[selected] ?? false);
	const loadingOlder = useStore(host.transcript.store, (state) => state.loadingOlder[selected] ?? false);
	const loadOlder = () => {
		follower.hold();
		void host.transcript.loadOlder(selected);
	};

	useEffect(() => {
		if (!focused) return;
		const element = scroll.current?.querySelector(`[data-entry="${CSS.escape(focused.id)}"]`);
		if (!element) return;
		follower.hold();
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
	}, [focused, follower]);

	if (view !== null) {
		const item = viewItems.find((each) => each.id === view);
		const View = item ? viewComponents.get(item.component) : undefined;
		return (
			<div className="transcript-pane">{View ? createElement(View, { host, data: item?.data }) : <div className="surface-missing">view "{view}" is not contributed</div>}</div>
		);
	}

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
							<div className="transcript" ref={scroll} data-narrow={narrow ? "" : undefined}>
								<div className="transcript-inner" ref={inner}>
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
											const live = working && index === display.length - 1;
											const current = index === currentStepIndex;
											return Step
												? createElement(Step, {
														key: `s:${row.step.key}`,
														host,
														data: {
															group: row.step,
															live,
															...(live ? { session: selected } : {}),
															...(current && !live ? { defaultOpen: lastStepOpen } : {}),
															...(current ? { onOpenChange: (open: boolean) => host.transcript.setStepOpen(selected, open) } : {}),
															onAlign: alignStep,
														},
													})
												: null;
										}
										return <TranscriptRow key={`i:${row.item.id}`} host={host} session={selected} item={row.item} />;
									})}
									<StreamTail
										host={host}
										session={selected}
										working={working}
										mergeFirstStep={mergeFirstStep}
										onStepOpenChange={(open) => host.transcript.setStepOpen(selected, open)}
										onAlign={alignStep}
									/>
									{error ? (
										<div className="sys-error">
											<span className="sys-error-tag">ERR</span>
											<span className="sys-error-text">{error}</span>
										</div>
									) : null}
								</div>
							</div>
							{following ? null : (
								<button type="button" className="back-to-bottom" aria-label="Back to latest" onClick={() => follower.pin(true)}>
									<ArrowDownIcon size={15} />
								</button>
							)}
						</div>

						<div className="composer-slot">
							<Composer host={host} onSent={() => follower.pin(true)} />
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
