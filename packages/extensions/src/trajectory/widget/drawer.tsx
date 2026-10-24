import type { Host } from "@milu/window/api";
import { projectView } from "@milu/window/api";
import { Tip } from "@milu/window/api/tooltip";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { trajectoryNode, stringify } from "../meta.ts";
import { buildData, type TrajectoryDetail, type TrajectoryRecord, type TrajectoryTone } from "../model.ts";
import { scan } from "../scan.ts";
import type { TrajectoryMode, TrajectoryService } from "../service/index.ts";

const ROW_H = 28;
const GRID_CLASS = "trajectory-grid";
const MODES: readonly TrajectoryMode[] = ["slice", "view"];

interface DisplayRow {
	readonly key: string;
	readonly record: TrajectoryRecord;
	readonly marks?: number;
	readonly chip: string;
	readonly tone: TrajectoryTone;
	readonly caption: string;
	readonly details: readonly TrajectoryDetail[];
}

interface FlatRow extends DisplayRow {
	readonly runStart: boolean;
}

const CHIP_TONE: Partial<Record<TrajectoryTone, string>> = { system: "text-ink", change: "text-ink-soft", custom: "text-ink-soft", plain: "text-muted" };
const CAPTION_TONE: Partial<Record<TrajectoryTone, string>> = { change: "text-ink-soft", compact: "text-ink-soft", custom: "text-ink-soft", plain: "text-ink-soft" };

const pad = (value: number): string => String(value).padStart(2, "0");

function stampOf(time: number): string {
	const date = new Date(time);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const short = (text: string): string => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

function Detail(props: { detail: TrajectoryDetail }) {
	const { detail } = props;
	const label = detail.label !== undefined && detail.label !== "" ? detail.label : null;
	const description = detail.description !== undefined && detail.description !== "" ? detail.description : null;
	const facts = detail.meta ?? [];
	const head =
		label !== null ? (
			<div className="mt-2 flex flex-col gap-1.5">
				<span className="font-mono text-[10px] text-ink-soft">{label}</span>
				{description !== null ? <span className="truncate font-mono text-[10px] text-muted">{description}</span> : null}
			</div>
		) : description !== null ? (
			<div className="mt-2 font-mono text-[10px] text-muted">{description}</div>
		) : null;
	const factsLine =
		facts.length > 0 ? (
			<div className={`mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[10px] ${detail.error ? "text-signal" : "text-muted"}`}>
				{facts.map((fact) => (
					<span key={fact}>{fact}</span>
				))}
			</div>
		) : null;
	const content = detail.content;

	if (content === undefined) {
		return (
			<>
				{head}
				{factsLine}
			</>
		);
	}
	if (content.kind === "text") {
		return (
			<>
				<div
					className={`mt-2 max-h-[220px] overflow-y-auto border-l-2 border-line pl-2.5 font-serif text-[14px] leading-[1.6] whitespace-pre-wrap ${detail.error ? "text-signal" : "text-ink-soft"}`}
				>
					{content.value}
				</div>
				{factsLine}
			</>
		);
	}
	return (
		<>
			{head}
			{factsLine}
			<pre
				className={`mt-2 max-h-[140px] overflow-auto rounded-[4px] border px-2 py-1.5 font-mono text-[10px] leading-[1.6] break-words whitespace-pre-wrap ${
					detail.error ? "border-signal/60 text-signal" : "border-line text-ink-soft"
				}`}
			>
				{content.value}
			</pre>
		</>
	);
}

export function TrajectoryDrawer(props: { host: Host; service: TrajectoryService }) {
	const { service } = props;
	const entries = useStore(service.store, (state) => state.entries);
	const sliceItems = useStore(service.store, (state) => state.sliceItems);
	const mode = useStore(service.store, (state) => state.mode);
	const total = useStore(service.store, (state) => state.total);
	const hasMore = useStore(service.store, (state) => state.hasMore);
	const loading = useStore(service.store, (state) => state.loading);
	const error = useStore(service.store, (state) => state.error);

	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [popTop, setPopTop] = useState<number | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const drawer = useRef<HTMLElement>(null);
	const popover = useRef<HTMLDivElement>(null);

	const log = useMemo(() => entries.map((entry) => entry.entry), [entries]);
	const records = useMemo(() => buildData(log), [log]);
	const scanned = useMemo(() => scan(records), [records]);

	const rows = useMemo<readonly TrajectoryRecord[]>(() => {
		if (mode === "view") {
			const ids = new Set(projectView(log).map((item) => item.id));
			return scanned.data.filter((record) => ids.has(record.entryId));
		}
		if (mode === "slice") {
			const byId = new Map(scanned.data.map((record) => [record.entryId, record]));
			const out: TrajectoryRecord[] = [];
			for (const item of sliceItems) {
				const record = byId.get(item.id);
				if (!record) continue;
				out.push({ ...record, sliceMessage: item.message });
			}
			return out;
		}
		return scanned.data;
	}, [scanned, mode, log, sliceItems]);

	const flatRows = useMemo<FlatRow[]>(() => {
		const out: DisplayRow[] = [];
		for (const record of rows) {
			const node = trajectoryNode(record);
			if (node.rows !== undefined) {
				let marks = record.marks;
				for (const [index, part] of node.rows.entries()) {
					out.push({
						key: `a:${record.entryId}:${index}`,
						record,
						...(marks ? { marks } : {}),
						chip: part.chip ?? "MSG",
						tone: part.tone ?? node.tone ?? "plain",
						caption: part.caption ?? "",
						details: part.details ?? [],
					});
					marks = 0;
				}
				continue;
			}
			out.push({
				key: `r:${record.entryId}`,
				record,
				...(record.marks ? { marks: record.marks } : {}),
				chip: node.chip,
				tone: node.tone,
				caption: node.caption,
				details: node.details,
			});
		}
		return out.map((row, index) => ({ ...row, runStart: index === 0 || out[index - 1]!.record.run !== row.record.run }));
	}, [rows]);

	// oxlint-disable-next-line react/incompatible-library
	const virtualizer = useVirtualizer({ count: flatRows.length, estimateSize: () => ROW_H, getScrollElement: () => scroller.current, overscan: 10 });
	const selected = selectedKey !== null ? (flatRows.find((row) => row.key === selectedKey) ?? null) : null;

	useEffect(() => {
		if (selectedKey === null) {
			setPopTop(null);
			return;
		}
		const row = scroller.current?.querySelector(`[data-row="${CSS.escape(selectedKey)}"]`);
		const height = popover.current?.offsetHeight ?? 240;
		if (!row || !drawer.current) {
			setPopTop(8);
			return;
		}
		const rowRect = row.getBoundingClientRect();
		const drawerRect = drawer.current.getBoundingClientRect();
		const centre = rowRect.top + rowRect.height / 2 - drawerRect.top;
		setPopTop(Math.min(Math.max(centre - height / 2, 8), Math.max(8, drawerRect.height - height - 8)));
	}, [selectedKey]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (selectedKey !== null) {
				event.preventDefault();
				setSelectedKey(null);
				return;
			}
			event.preventDefault();
			service.close();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selectedKey, service]);

	const prepending = useRef(false);
	const previousRows = useRef(flatRows.length);
	const follow = useRef(true);

	useEffect(() => {
		const element = scroller.current;
		if (!element || !follow.current) return;
		const pin = () => {
			if (follow.current) element.scrollTop = element.scrollHeight;
		};
		pin();
		const frame = requestAnimationFrame(pin);
		const settle = window.setTimeout(pin, 80);
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(settle);
		};
	}, [flatRows.length, loading]);

	useEffect(() => {
		const element = scroller.current;
		const added = flatRows.length - previousRows.current;
		previousRows.current = flatRows.length;
		if (!prepending.current || added <= 0 || !element) return;
		prepending.current = false;
		element.scrollTop += added * ROW_H;
	}, [flatRows.length]);

	const loadOlder = (): void => {
		setSelectedKey(null);
		follow.current = false;
		prepending.current = true;
		void service.loadOlder();
	};

	const countText =
		mode === "slice"
			? `slice · ${rows.length} nodes shown · ${scanned.turns.length} turns`
			: mode === "view"
				? `view · ${rows.length} rows shown`
				: `origin · all ${total} entries · ${scanned.turns.length} turns`;
	const footText = mode === "slice" ? "model context (slice)" : mode === "view" ? "chat view" : "whole log · paged";

	return (
		<aside
			className="absolute top-[var(--bar-h)] right-0 bottom-0 z-30 flex w-[440px] max-w-[72vw] flex-col border-l border-line bg-surface py-4 animate-[trajectory-in_220ms_cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none"
			ref={drawer}
			aria-label="Trajectory"
		>
			<div className="flex items-baseline gap-2 border-b border-line px-4 pb-3">
				<span className="font-sans text-[10px] tracking-[0.2em] text-muted uppercase">Trajectory</span>
				<div className="ml-auto flex flex-none items-center gap-0.5 rounded-[4px] border border-line p-[1px]" role="group" aria-label="Timeline Projection">
					{MODES.map((each) => (
						<Tip key={each} label={each === "slice" ? "Model context (slice)" : "Chat view"}>
							<button
								type="button"
								className={`cursor-pointer rounded-[4px] px-1.5 py-[1px] font-mono text-[10px] tracking-[0.12em] uppercase transition-colors ${
									mode === each ? "bg-ink text-canvas" : "bg-transparent text-muted hover:text-ink"
								}`}
								aria-pressed={mode === each}
								aria-label={each === "slice" ? "Model context (slice)" : "Chat view"}
								onClick={() => service.setMode(each)}
							>
								{each}
							</button>
						</Tip>
					))}
				</div>
				<button
					type="button"
					aria-label="Close"
					className="ml-2 cursor-pointer border-0 bg-transparent p-0 font-sans text-[16px] leading-none text-muted hover:text-ink"
					onClick={() => service.close()}
				>
					×
				</button>
			</div>

			{error ? <div className="mx-4 mt-2 border-[0.5px] border-signal/40 px-2.5 py-2 font-mono text-[11px] text-signal">{error}</div> : null}

			{flatRows.length === 0 ? (
				<div className="px-4 py-6 font-mono text-[11px] text-muted">{loading ? "loading…" : "no log entries yet — run a conversation first"}</div>
			) : (
				<div
					className="min-h-0 flex-1 overflow-y-auto pt-2"
					ref={scroller}
					onScroll={() => {
						const element = scroller.current;
						if (element) follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 8;
						if (selectedKey !== null) setSelectedKey(null);
					}}
				>
					{hasMore ? (
						<button
							type="button"
							className="w-full cursor-pointer border-0 border-b border-line bg-canvas py-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-soft uppercase hover:bg-hover"
							onClick={loadOlder}
							disabled={loading}
						>
							{loading ? "loading…" : "↑ load earlier"}
						</button>
					) : null}
					<div className={GRID_CLASS} style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
						{virtualizer.getVirtualItems().map((item) => {
							const row = flatRows[item.index];
							if (!row) return null;
							return (
								<div key={item.key} style={{ position: "absolute", top: 0, transform: `translateY(${item.start}px)`, width: "100%" }} data-index={item.index}>
									<div
										className={`relative h-7 w-full border-t px-4 ${row.runStart ? "border-t-[color-mix(in_srgb,var(--ink)_22%,transparent)]" : "border-line-soft"} ${
											selectedKey === row.key ? "bg-hover" : ""
										}`}
										data-row={row.key}
									>
										{row.marks ? (
											<span className="pointer-events-none absolute top-0 left-4 z-10 size-[9px] -translate-y-1/2 rounded-full border-2 border-surface bg-signal" />
										) : null}
										<button
											type="button"
											className="flex h-full w-full cursor-pointer items-center gap-2 bg-transparent text-left"
											onClick={() => setSelectedKey(selectedKey === row.key ? null : row.key)}
										>
											<b className={`min-w-[38px] flex-none text-left font-mono text-[10px] font-medium ${CHIP_TONE[row.tone] ?? "text-muted"}`}>{row.chip}</b>
											<span className={`min-w-0 flex-1 truncate font-serif text-[12px] ${CAPTION_TONE[row.tone] ?? "text-ink"}`}>{short(row.caption)}</span>
										</button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			<div className="flex items-baseline justify-between gap-2 px-4 pt-2 font-sans text-[10px] text-muted">
				<span className="font-mono">{countText}</span>
				<span className="font-mono">{footText}</span>
			</div>

			{selected !== null && popTop !== null ? (
				<div
					className="absolute right-[calc(100%+14px)] z-20 flex max-h-[calc(100vh-24px)] w-[min(380px,54vw)] flex-col rounded-md border border-line bg-surface shadow-[0_4px_12px_color-mix(in_srgb,var(--ink)_12%,transparent)]"
					style={{ top: `${popTop}px` }}
					ref={popover}
					role="dialog"
					aria-label="Trajectory detail"
				>
					<div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
						<span className="rounded-[4px] border-[0.5px] border-line px-1 py-[1px] font-mono text-[10px] tracking-[0.08em] text-muted">{selected.chip}</span>
						<span className="min-w-0 flex-1 truncate font-sans text-[13px] text-ink-soft">{short(selected.caption)}</span>
						<button
							type="button"
							aria-label="Close"
							className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted-soft hover:bg-hover hover:text-ink"
							onClick={() => setSelectedKey(null)}
						>
							×
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
						{selected.details.map((detail, index) => (
							<Detail key={`${selected.key}:${detail.label ?? detail.description ?? index}`} detail={detail} />
						))}
						{selected.record.sliceMessage !== undefined ? (
							<div className="mt-3 border-t border-line pt-2.5">
								<div className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">AgentMessage</div>
								<div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
									<span className="rounded-[4px] border-[0.5px] border-line px-1 py-[1px] font-mono text-[10px] text-muted">
										{String((selected.record.sliceMessage as { role?: unknown }).role ?? "")}
									</span>
									<span className="min-w-0 truncate font-mono text-[10px] text-muted">{selected.record.entryId}</span>
								</div>
								<pre className="mt-2 max-h-[220px] overflow-auto rounded-[6px] border border-line bg-[color-mix(in_srgb,var(--hover)_60%,transparent)] px-2.5 py-2 font-mono text-[10px] leading-[1.6] break-words whitespace-pre-wrap text-ink-soft">
									{stringify(selected.record.sliceMessage)}
								</pre>
							</div>
						) : null}
					</div>
					<div className="border-t border-line px-4 py-2">
						<div className="font-mono text-[10px] text-muted">
							entry {selected.record.entryId} · {stampOf(selected.record.time)}
						</div>
					</div>
				</div>
			) : null}
		</aside>
	);
}
