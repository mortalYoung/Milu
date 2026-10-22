import { List } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import {
	createServiceId,
	type FrontEndService,
	formatHistoryTime,
	projectView,
	replyRows,
	type SelectionService,
	SelectionServiceId,
	type Service,
	type SlotComponent,
	type SurfaceProps,
} from "../host/index.ts";
import { Tip } from "../host/tooltip.tsx";

const NO_ENTRIES: readonly never[] = [];

export class RepliesService implements Service {
	readonly store = createStore<{ open: boolean }>()(() => ({ open: false }));

	private readonly _unsubscribe: () => void;

	constructor(selection: SelectionService) {
		this._unsubscribe = selection.store.subscribe(() => this.close());
	}

	toggle(): void {
		this.store.setState((state) => ({ ...state, open: !state.open }), true);
	}

	close(): void {
		if (!this.store.getState().open) return;
		this.store.setState((state) => ({ ...state, open: false }), true);
	}

	dispose(): void {
		this._unsubscribe();
	}
}

export const RepliesServiceId = createServiceId<RepliesService>("replies.state");

function label(text: string): string {
	const line = text.split("\n").find((each) => each.trim() !== "") ?? "";
	return line.length > 42 ? `${line.slice(0, 42)}…` : line;
}

function RepliesButton(props: SurfaceProps) {
	const service = props.host.get(RepliesServiceId);
	const open = useStore(service.store, (state) => state.open);
	const selected = useStore(props.host.selection.store, (state) => state.selected);
	if (selected === "") return null;
	const wording = open ? "Hide replies" : "Show replies";
	return (
		<Tip label={wording}>
			<button
				type="button"
				className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 text-ink transition-colors duration-150 hover:bg-hover ${open ? "bg-hover" : "bg-transparent"}`}
				aria-label={wording}
				aria-pressed={open}
				onClick={() => service.toggle()}
			>
				<List size={15} />
			</button>
		</Tip>
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
	const follow = useRef(true);

	useEffect(() => {
		if (!open) {
			follow.current = true;
			return;
		}
		const element = list.current;
		if (!element || !follow.current) return;
		const pin = () => {
			if (follow.current) element.scrollTop = element.scrollHeight;
		};
		pin();
		const frame = requestAnimationFrame(pin);
		return () => cancelAnimationFrame(frame);
	}, [open, rows]);

	if (!open) return null;

	return (
		<aside
			className="absolute top-[calc(var(--bar-h,52px)+8px)] right-4 z-20 flex max-h-[65vh] w-[246px] flex-col overflow-hidden rounded-md border border-line bg-surface shadow-[0_6px_20px_color-mix(in_srgb,var(--ink)_8%,transparent)]"
			aria-label="Replies"
		>
			<div className="flex items-baseline justify-between border-b border-line px-4 pt-3 pb-2">
				<span className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Replies</span>
				<span className="font-mono text-[10px] text-ink-soft">{rows.length}</span>
			</div>
			<div
				className="flex min-h-0 flex-col overflow-y-auto overscroll-contain py-1"
				ref={list}
				onScroll={() => {
					const element = list.current;
					if (element) follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 8;
				}}
			>
				{rows.length === 0 ? (
					<span className="px-3 py-3 font-sans text-[12px] text-muted">no replies yet</span>
				) : (
					rows.map((row) => (
						<button
							key={row.id}
							type="button"
							className={`relative flex w-full cursor-pointer flex-col gap-[2px] border-0 px-4 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink focus-visible:[outline-offset:-2px] ${
								active === row.id ? "bg-hover" : ""
							}`}
							onClick={() => {
								setActive(row.id);
								host.transcript.focus(row.questionId ?? row.id);
							}}
						>
							<span className="flex items-baseline justify-between gap-2">
								<span className="truncate font-sans text-[10px] text-muted">{row.question ? label(row.question) : "—"}</span>
								<span className="shrink-0 font-mono text-[10px] text-muted">{formatHistoryTime(row.time)}</span>
							</span>
							<span className="truncate font-sans text-[13px] leading-[1.45] text-ink">{label(row.text)}</span>
							{row.count > 1 ? <span className="self-start font-mono text-[10px] text-line/80">stack · {row.count}</span> : null}
						</button>
					))
				)}
			</div>
		</aside>
	);
}

export const services: readonly FrontEndService[] = [{ id: RepliesServiceId, create: (container) => new RepliesService(container.get(SelectionServiceId)) }];

export const slots: readonly SlotComponent[] = [
	{ id: "replies.bar", component: RepliesButton },
	{ id: "replies.pane", component: RepliesPane },
];
