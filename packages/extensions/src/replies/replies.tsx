import { List } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { createServiceId, formatHistoryTime, projectView, replyRows, type Service, type SlotComponent, type SurfaceProps } from "../host/index.ts";

import "./replies.css";

const NO_ENTRIES: readonly never[] = [];

export class RepliesService implements Service {
	readonly store = createStore<{ open: boolean }>()(() => ({ open: false }));

	toggle(): void {
		this.store.setState((state) => ({ ...state, open: !state.open }), true);
	}

	dispose(): void {}
}

export const RepliesServiceId = createServiceId<RepliesService>("replies.state");

function label(text: string): string {
	const line = text.split("\n").find((each) => each.trim() !== "") ?? "";
	return line.length > 42 ? `${line.slice(0, 42)}…` : line;
}

function RepliesButton(props: SurfaceProps) {
	const service = props.host.get(RepliesServiceId);
	const open = useStore(service.store, (state) => state.open);
	const wording = open ? "Hide replies" : "Show replies";
	return (
		<button type="button" className={open ? "replies-bar is-on" : "replies-bar"} aria-label={wording} aria-pressed={open} title={wording} onClick={() => service.toggle()}>
			<List size={15} />
		</button>
	);
}

function RepliesPane(props: SurfaceProps) {
	const { host } = props;
	const service = host.get(RepliesServiceId);
	const open = useStore(service.store, (state) => state.open);
	const selected = useStore(host.selection.store, (state) => state.selected);
	const entries = useStore(host.transcript.store, (state) => state.logs[selected] ?? NO_ENTRIES);

	const rows = useMemo(() => replyRows(projectView(entries.map((seq) => seq.entry))), [entries]);
	const [active, setActive] = useState<string | null>(null);
	const list = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		list.current?.scrollTo({ top: list.current.scrollHeight });
	}, [open, rows]);

	if (!open) return null;

	return (
		<aside className="outline" aria-label="Replies">
			<div className="outline-head">
				<span className="outline-label">Replies</span>
				<span className="outline-count">{rows.length}</span>
			</div>
			<div className="outline-list" ref={list}>
				{rows.length === 0 ? (
					<span className="outline-empty">no replies yet</span>
				) : (
					rows.map((row) => (
						<button
							key={row.id}
							type="button"
							className={active === row.id ? "outline-item active" : "outline-item"}
							onClick={() => {
								setActive(row.id);
								host.transcript.focus(row.id);
							}}
						>
							<span className="outline-meta">
								<span className="outline-q">{row.question ? label(row.question) : "—"}</span>
								<span className="outline-time">{formatHistoryTime(row.time)}</span>
							</span>
							<span className="outline-a">{label(row.text)}</span>
							{row.count > 1 ? <span className="outline-stack">stack · {row.count}</span> : null}
						</button>
					))
				)}
			</div>
		</aside>
	);
}

export const services = [{ id: RepliesServiceId, create: () => new RepliesService() }];

export const slots: readonly SlotComponent[] = [
	{ id: "replies.bar", component: RepliesButton },
	{ id: "replies.pane", component: RepliesPane },
];
