import type { SlotProps, StepGroup, ViewItem } from "@milu/window/api";
import { rowKindOf } from "@milu/window/api";
import { createElement, type ReactNode, useEffect, useState } from "react";

import type { StepDisplay } from "../index.ts";
import { NoteFallback, SayRow, ThinkingRow, ToolRow } from "./note.tsx";

interface StepData {
	readonly group: StepGroup;
	readonly live: boolean;
	readonly header?: boolean;
}

const CAPSULE = "inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-[3px] font-mono text-[10px] text-muted";

function time(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
}

/** "Running for 12s" while it streams, "Completed in 12s" once the last row is in. */
function useHeaderStamp(group: StepGroup, live: boolean): string {
	const first = group.rows[0]?.time ?? 0;
	const last = group.rows[group.rows.length - 1]?.time ?? first;
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!live) return;
		const tick = () => setElapsed(Math.max(0, Date.now() - first));
		tick();
		const timer = window.setInterval(tick, 1000);
		return () => window.clearInterval(timer);
	}, [live, first]);

	return live ? `Running for ${time(elapsed)}` : `Completed in ${time(last - first)}`;
}

export function StepRow(props: SlotProps) {
	const { group, live, header = true } = props.data as StepData;
	const [display, setDisplay] = useState<StepDisplay>("flat");
	const [open, setOpen] = useState(false);
	const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
	const stamp = useHeaderStamp(group, live);

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
		<span className="flex min-w-0 items-center gap-2">
			{live ? <span className="work-dot shrink-0" /> : null}
			{stamp}
		</span>
	);
	const rows = <div className="mt-1.5 grid gap-1.5">{group.rows.map((item) => renderRow(props, item, openRows.has(item.id), toggleRow))}</div>;

	if (!header) return rows;

	return (
		<div className="mt-3 min-w-0">
			{collapsed ? (
				<button type="button" className={CAPSULE} aria-expanded={open} onClick={() => setOpen(!open)}>
					<span className="shrink-0 text-muted-soft">{open ? "⌄" : "›"}</span>
					{head}
				</button>
			) : (
				<div className="font-mono text-[10px] leading-[1.7] text-muted-soft">{head}</div>
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
