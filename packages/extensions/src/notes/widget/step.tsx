import type { SlotProps, StepGroup, ViewItem } from "@milu/window/api";
import { liveRowsOf, oneLine, rowKindOf } from "@milu/window/api";
import { Brain, ChevronRight, type LucideIcon } from "lucide-react";
import { createElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";

import type { StepDisplay } from "../index.ts";
import { Elide, NoteFallback, SayRow, ThinkingRow, ToolRow } from "./note.tsx";
import { toolArgs, toolIcon } from "./tool.ts";

interface StepData {
	readonly group: StepGroup;
	readonly live: boolean;
	readonly session?: string;
}

const HEAD = "flex min-w-0 items-baseline gap-2";

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

interface Latest {
	readonly icon: LucideIcon | null;
	readonly label: string;
	readonly detail: string;
	readonly code: boolean;
	readonly failed: boolean;
}

function latestStep(group: StepGroup): Latest | null {
	const item = group.rows[group.rows.length - 1];
	if (!item) return null;
	if (item.tool) return { icon: toolIcon(item.tool.name), label: oneLine(item.tool.name) || "tool", detail: toolArgs(item.tool), code: true, failed: item.tool.status === "error" };
	if (item.thinking) return { icon: Brain, label: "thinking", detail: item.thinking.redacted ? "redacted" : oneLine(item.thinking.text), code: false, failed: false };
	return { icon: null, label: "", detail: oneLine(item.text), code: false, failed: false };
}

function LatestStep(props: { step: Latest }) {
	const { icon: Icon, label, detail, code, failed } = props.step;
	return (
		<>
			<span className="shrink-0 text-line-strong">|</span>
			<span className="flex min-w-0 flex-1 items-center gap-1">
				{Icon ? <Icon size={12} aria-hidden="true" className={failed ? "shrink-0 text-signal" : "shrink-0"} /> : null}
				{label === "" ? null : <span className="shrink-0">{label}</span>}
				{label === "" || detail === "" ? null : <span className="shrink-0 text-line-strong">·</span>}
				{detail === "" ? null : <Elide text={detail} className={`min-w-0 flex-1 truncate text-muted-soft${code ? " font-mono text-[13px]" : ""}`} />}
			</span>
		</>
	);
}

/** "Running for 12s" while it streams, "Stopped after 12s" when it was cut, "Completed in 12s" once the last row is in. */
function useHeaderStamp(group: StepGroup, live: boolean): Stamp {
	const first = group.rows[0]?.time ?? 0;
	const last = group.rows[group.rows.length - 1]?.time ?? first;
	const stopped = group.rows.some((row) => row.stopped === true);
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
	return took === "" ? { label: "Completed", duration: "" } : { label: "Completed in", duration: took };
}

export function StepRow(props: SlotProps) {
	const { group, live, session } = props.data as StepData;
	const partial = useStore(props.host.transcript.store, (state) => (live && session ? (state.partials[session] ?? null) : null));
	const started = useStore(props.host.transcript.store, (state) => (live && session ? (state.started[session] ?? 0) : 0));
	const merged = useMemo(() => {
		if (!live || !session || !partial) return group;
		const first = liveRowsOf(partial, started)[0];
		if (!first || !("step" in first)) return group;
		return { ...group, rows: [...group.rows, ...first.step.rows] };
	}, [group, live, session, partial, started]);
	const [display, setDisplay] = useState<StepDisplay>("flat");
	const [open, setOpen] = useState(false);
	const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
	const stamp = useHeaderStamp(merged, live);

	useEffect(() => {
		let alive = true;
		const load = () => {
			void props.host.actions
				.request<StepDisplay>("notes.display")
				.then((next) => {
					if (alive && next) setDisplay(next);
				})
				.catch(() => undefined);
		};
		load();
		const subscription = props.host.connection.onLive((event) => {
			if (event.type === "settings") load();
		});
		return () => {
			alive = false;
			subscription.dispose();
		};
	}, [props.host]);

	const collapsed = display === "collapsed";
	const folded = collapsed && !open;

	const toggleRow = (id: string): void => {
		setOpenRows((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const head = (
		<>
			{live ? <span className="work-dot shrink-0 self-center" /> : null}
			<span className="shrink-0">{stamp.label}</span>
			{stamp.duration === "" ? null : <span className="shrink-0 font-mono text-[13px] text-muted">{stamp.duration}</span>}
		</>
	);
	const latest = live ? latestStep(merged) : null;
	const rows = <div className="mt-2 grid gap-1.5">{merged.rows.map((item) => renderRow(props, item, openRows.has(item.id), toggleRow))}</div>;

	return (
		<div className="mt-6 min-w-0">
			{collapsed ? (
				<button
					type="button"
					className="flex w-full min-w-0 max-w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left font-sans text-[15px] leading-[1.5] text-muted hover:text-ink"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					<span className="grid size-4 shrink-0 place-items-center text-muted-soft">
						<ChevronRight size={14} aria-hidden="true" className={`transition-transform duration-150 motion-reduce:transition-none${open ? " rotate-90" : ""}`} />
					</span>
					<span className={HEAD}>{head}</span>
					{latest ? <LatestStep step={latest} /> : null}
				</button>
			) : (
				<div className={`${HEAD} font-sans text-[15px] leading-[1.714] text-muted-soft`}>{head}</div>
			)}
			{folded ? null : rows}
		</div>
	);
}

function renderRow(props: SlotProps, item: ViewItem, open: boolean, onToggle: (id: string) => void): ReactNode {
	if (item.tool) return createElement(ToolRow, { host: props.host, data: { item, open, onToggle: () => onToggle(item.id), capsule: true } });
	if (item.thinking) return createElement(ThinkingRow, { host: props.host, data: { item, open, onToggle: () => onToggle(item.id) } });
	if (item.say) return createElement(SayRow, { host: props.host, data: { item } });
	const Note = props.host.rows.get(rowKindOf(item));
	return Note ? createElement(Note, { host: props.host, data: { item, open, onToggle: () => onToggle(item.id) } }) : createElement(NoteFallback, { item });
}
