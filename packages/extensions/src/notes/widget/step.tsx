import type { SlotProps, StepGroup, ViewItem } from "@milu/window/api";
import { liveRowsOf, oneLine } from "@milu/window/api";
import { Markdown } from "@milu/window/api/markdown/react";
import { Brain, ChevronDown, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { useStore } from "zustand";

import { Elide, NoteFallback } from "./note.tsx";
import { toolArgs, toolIcon } from "./tool.ts";

interface StepData {
	readonly group: StepGroup;
	readonly live: boolean;
	readonly session?: string;
	readonly defaultOpen?: boolean;
	readonly onOpenChange?: (open: boolean) => void;
	readonly onAlign?: (element: HTMLElement) => void;
}

interface Family {
	readonly key: string;
	readonly label: string;
	readonly icon: LucideIcon;
	readonly count: number;
}

interface Latest {
	readonly id: string;
	readonly icon: LucideIcon | null;
	readonly label: string;
	readonly detail: string;
	readonly failed: boolean;
}

interface Stamp {
	readonly label: string;
	readonly duration: string;
}

/** Zero is not a measurement worth printing: a step that took no time says "Completed", not "Completed in 0s". */
function span(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds === 0) return "";
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function familyOf(item: ViewItem): Omit<Family, "count"> | null {
	if (item.thinking) return { key: "think", label: "thinking", icon: Brain };
	if (item.tool) return { key: "tool", label: "tool", icon: Wrench };
	return null;
}

function familiesOf(rows: readonly ViewItem[]): readonly Family[] {
	const families = new Map<string, Family>();
	for (const row of rows) {
		const family = familyOf(row);
		if (!family) continue;
		const current = families.get(family.key);
		families.set(family.key, current ? { ...current, count: current.count + 1 } : { ...family, count: 1 });
	}
	return [...families.values()];
}

function latestOf(rows: readonly ViewItem[]): Latest | null {
	const item = rows[rows.length - 1];
	if (!item) return null;
	if (item.tool) {
		return { id: item.id, icon: toolIcon(item.tool.name), label: item.tool.name, detail: toolArgs(item.tool), failed: item.tool.status === "error" };
	}
	if (item.thinking) {
		return { id: item.id, icon: Brain, label: "thinking", detail: item.thinking.redacted ? "redacted" : oneLine(item.thinking.text), failed: false };
	}
	return { id: item.id, icon: null, label: "", detail: oneLine(item.text), failed: false };
}

/** "Running for 12s" while it streams, "Thought for 12s" when it only thought, "Completed in 12s" once the last row is in. */
function useHeaderStamp(group: StepGroup, live: boolean): Stamp {
	const first = group.rows[0]?.time ?? 0;
	const last = group.rows[group.rows.length - 1]?.time ?? first;
	const stopped = group.rows.some((row) => row.stopped === true);
	const onlyThinking = group.rows.length > 0 && group.rows.every((row) => row.thinking !== undefined);
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!live) return;
		const tick = () => setElapsed(Math.max(0, Date.now() - first));
		tick();
		const timer = window.setInterval(tick, 1000);
		return () => window.clearInterval(timer);
	}, [live, first]);

	if (live) return { label: "Running for", duration: span(elapsed) || "0s" };
	const took = span(last - first);
	if (stopped) return took === "" ? { label: "Stopped", duration: "" } : { label: "Stopped after", duration: took };
	if (onlyThinking) return took === "" ? { label: "Thought", duration: "" } : { label: "Thought for", duration: took };
	return took === "" ? { label: "Completed", duration: "" } : { label: "Completed in", duration: took };
}

/** The same edge logic the session list uses: a mask appears only when there is more content past the edge. */
function useScrollEdges<T extends HTMLElement>(): readonly [RefObject<T | null>, string] {
	const ref = useRef<T>(null);
	const [edges, setEdges] = useState({ above: false, below: false });

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				frame = 0;
				setEdges({
					above: element.scrollTop > 2,
					below: element.scrollTop + element.clientHeight < element.scrollHeight - 2,
				});
			});
		};
		measure();
		element.addEventListener("scroll", measure, { passive: true });
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		const mutations = new MutationObserver(measure);
		mutations.observe(element, { subtree: true, childList: true, characterData: true });
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("scroll", measure);
			resize.disconnect();
			mutations.disconnect();
		};
	}, []);

	return [ref, `edge-fade${edges.above ? " has-above" : ""}${edges.below ? " has-below" : ""}`];
}

export function StepRow(props: SlotProps) {
	const { group, live, session, defaultOpen, onOpenChange, onAlign } = props.data as StepData;
	const groupRef = useRef<HTMLDivElement>(null);
	const partial = useStore(props.host.transcript.store, (state) => (live && session ? (state.partials[session] ?? null) : null));
	const started = useStore(props.host.transcript.store, (state) => (live && session ? (state.started[session] ?? 0) : 0));
	const merged = useMemo(() => {
		if (!live || !session || !partial) return group;
		const first = liveRowsOf(partial, started)[0];
		if (!first || !("step" in first)) return group;
		return { ...group, rows: [...group.rows, ...first.step.rows] };
	}, [group, live, session, partial, started]);
	const [open, setOpen] = useState(() => defaultOpen === true);
	const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
	const stamp = useHeaderStamp(merged, live);
	const bodyId = useId();

	const families = useMemo(() => familiesOf(merged.rows), [merged.rows]);
	const failed = merged.rows.some((row) => row.tool?.status === "error");
	const stopped = merged.rows.some((row) => row.stopped === true);
	const latest = live || stopped ? latestOf(merged.rows) : null;
	const LatestIcon = latest?.icon ?? null;

	const toggleOpen = (): void => {
		const next = !open;
		setOpen(next);
		onOpenChange?.(next);
		if (!next) {
			const element = groupRef.current;
			if (element !== null) requestAnimationFrame(() => onAlign?.(element));
		}
	};

	const toggleRow = (id: string): void => {
		setOpenRows((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div className="step-ribbon mt-6 min-w-0" data-open={open} ref={groupRef}>
			<button type="button" className="step-head" aria-expanded={open} aria-controls={bodyId} onClick={toggleOpen} data-sticky-head>
				<span className="step-chev">
					<ChevronDown size={13} aria-hidden="true" />
				</span>
				<span className="step-stamp" key={stamp.label}>
					{stamp.label}
				</span>
				{stamp.duration === "" ? null : <span className="step-duration">{stamp.duration}</span>}
				{failed ? <span className="step-error-dot" title="a step failed" /> : null}
				{live ? <span className="work-dot shrink-0" aria-hidden="true" /> : null}
				{families.length === 0 ? null : (
					<span className="step-families" aria-hidden="true">
						{families.map((family) => {
							const FamilyIcon = family.icon;
							return (
								<span className="step-family" key={family.key} title={`${family.label} · ${family.count}`}>
									<FamilyIcon size={11} aria-hidden="true" />
									<span className="step-family-label">{family.label}</span>
									<span className="step-family-count" key={family.count}>
										{family.count}
									</span>
								</span>
							);
						})}
					</span>
				)}
				{latest === null ? null : (
					<span className={`step-latest${latest.failed ? " is-error" : ""}`} key={latest.id}>
						{LatestIcon === null ? null : <LatestIcon size={11} aria-hidden="true" />}
						{latest.label === "" ? null : <span className="step-latest-label">{latest.label}</span>}
						{latest.label !== "" && latest.detail !== "" ? <span className="step-sep">·</span> : null}
						{latest.detail === "" ? null : <Elide text={latest.detail} className="step-latest-detail" />}
					</span>
				)}
			</button>
			<div className="step-body" id={bodyId} inert={!open}>
				<div className="step-body-inner">
					<div className="step-ledger">{merged.rows.map((item, index) => renderRow(props, item, index, merged.rows, openRows.has(item.id), toggleRow))}</div>
				</div>
			</div>
		</div>
	);
}

function renderRow(props: SlotProps, item: ViewItem, index: number, rows: readonly ViewItem[], open: boolean, onToggle: (id: string) => void) {
	if (item.say) {
		return (
			<div className="step-say" key={item.id} data-entry={item.id}>
				<Markdown port={props.host.markdown} text={item.text} plain={item.live === true} />
			</div>
		);
	}
	if (!item.tool && !item.thinking) {
		return (
			<div className="step-entry" key={item.id} data-entry={item.id}>
				<NoteFallback item={item} />
			</div>
		);
	}

	const tool = item.tool;
	const failed = tool?.status === "error";
	const running = tool?.status === "running";
	const pending = tool?.status === "pending";
	const Icon = tool ? toolIcon(tool.name) : Brain;
	const args = tool ? toolArgs(tool) : "";
	const result = !tool ? "" : tool.status === "running" ? "loading…" : tool.status === "pending" ? "…" : (tool.result ?? "");
	const thinking = item.thinking?.redacted ? "redacted" : oneLine(item.thinking?.text ?? "");
	const previous = rows[index - 1];
	const took = previous === undefined ? "" : span(item.time - previous.time);

	return (
		<div className={`step-entry${item.thinking ? " is-think" : ""}`} key={item.id} data-entry={item.id}>
			<button
				type="button"
				className={`step-row${failed ? " is-error" : ""}${running ? " is-running" : ""}${pending ? " is-pending" : ""}`}
				aria-expanded={open}
				onClick={() => onToggle(item.id)}
			>
				<Icon size={12} aria-hidden="true" className="step-row-icon" />
				<span className="step-row-label">{tool ? tool.name : "thinking"}</span>
				<span className="step-row-detail">
					{tool ? (
						<>
							{args === "" ? null : (
								<span className="step-row-args" title={args}>
									{args}
								</span>
							)}
							{args !== "" && result !== "" ? <span className="step-sep">|</span> : null}
							{result === "" ? null : (
								<span className="step-row-result" title={result}>
									{result}
								</span>
							)}
						</>
					) : (
						<span className="step-row-thinking" title={thinking}>
							{thinking}
						</span>
					)}
				</span>
				<span className="step-row-took">{took === "" ? "—" : took}</span>
				<ChevronDown size={11} aria-hidden="true" className={`step-row-chev${open ? " is-open" : ""}`} />
			</button>
			{open ? <RowDetail host={props.host} item={item} /> : null}
		</div>
	);
}

function RowDetail(props: { readonly host: SlotProps["host"]; readonly item: ViewItem }) {
	const { item, host } = props;
	if (item.thinking) return <ThinkingDetail host={host} item={item} />;
	if (!item.tool) return null;
	return <ToolDetail tool={item.tool} />;
}

function ThinkingDetail(props: { readonly host: SlotProps["host"]; readonly item: ViewItem }) {
	const { item, host } = props;
	const [scrollRef, scrollClass] = useScrollEdges<HTMLDivElement>();
	const text = item.thinking?.redacted ? "redacted" : (item.thinking?.text ?? "");
	return (
		<div className="step-detail is-think">
			<div ref={scrollRef} className={`${scrollClass} step-detail-scroll`}>
				<Markdown port={host.markdown} text={text} plain={item.live === true} />
			</div>
		</div>
	);
}

function ToolDetail(props: { readonly tool: NonNullable<ViewItem["tool"]> }) {
	const [scrollRef, scrollClass] = useScrollEdges<HTMLDivElement>();
	const { tool } = props;
	const args = tool.args?.trim() ?? "";
	const result = tool.status === "running" ? "loading…" : tool.status === "pending" ? "…" : (tool.result ?? "");
	return (
		<div className="step-detail">
			<div ref={scrollRef} className={`${scrollClass} step-detail-scroll`}>
				<section className="step-detail-section">
					<span className="step-detail-label">args</span>
					<pre className="step-detail-code">{args || "(none)"}</pre>
				</section>
				<section className={`step-detail-section${tool.status === "error" ? " is-error" : ""}`}>
					<span className="step-detail-label">result</span>
					<pre className="step-detail-code">{result || "(no output)"}</pre>
				</section>
			</div>
		</div>
	);
}
