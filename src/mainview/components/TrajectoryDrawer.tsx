import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { stringifyArgs, type TrajectoryDetail, type TrajectoryTone, trajectoryNode } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { scan } from "../../shared/trajectory";
import { useSession } from "../lib/contexts/session-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import { ESCAPE_ORDER, useEscapeLayer } from "../lib/escape";
import { rowAnchorAt, rowAnchorTop, rowTopForIndex } from "../lib/scroll-anchor";
import { createScrollFollower } from "../lib/scroll-follower";
import type { TrajectoryMode } from "../lib/trajectory";
import { ScrollRegion } from "./ScrollRegion";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDateTime = (ts: number) => {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const short = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);

type DisplayRow = {
	key: string;
	record: TrajectoryRecord;
	marks?: number;
	chip: string;
	tone: TrajectoryTone;
	caption: string;
	details: TrajectoryDetail[];
	band?: "cell" | "tool" | "think";
};

type FlatRow = DisplayRow & { runStart: boolean };

const ROW_H = 28;
const BAND_COL = 18;
const BAND_WINDOW = 80;
const BAND_BUFFER = 30;
const GRID_CLASS = "traj-grid";

/** Content offset of the first virtual row: the grid sits below the load-earlier button, so the
 * anchor arithmetic starts where the grid starts, not where the scroller's content starts. */
function rowOrigin(el: HTMLElement): number {
	const grid = el.querySelector<HTMLElement>(`.${GRID_CLASS}`);
	if (!grid) return 0;
	return grid.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
}

export function TrajectoryDrawer() {
	const trajectory = useTrajectory();
	const session = useSession();
	const open = useStore(trajectory.store, (state) => state.open);
	const records = useStore(trajectory.store, (state) => state.records);
	const mode = useStore(trajectory.store, (state) => state.mode);
	const total = useStore(session.store, (state) => state.origin.total);
	const loading = useStore(session.store, (state) => state.origin.loading);
	const hasMore = useStore(session.store, (state) => state.origin.hasMore);

	if (!open) return null;
	return (
		<DrawerContent
			records={records}
			total={total}
			mode={mode}
			onModeChange={trajectory.mutate.changeMode}
			loading={loading}
			hasMore={hasMore}
			loadingOlder={loading}
			onLoadOlder={() => session.mutate.originLoadMore()}
			onClose={() => trajectory.mutate.setOpen(false)}
		/>
	);
}

function DrawerContent(props: {
	records: TrajectoryRecord[];
	total: number;
	mode: TrajectoryMode;
	onModeChange: (mode: TrajectoryMode) => void;
	loading: boolean;
	hasMore: boolean;
	loadingOlder: boolean;
	onLoadOlder: () => Promise<void>;
	onClose: () => void;
}) {
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [popStyle, setPopStyle] = useState<{ top: number; arrowY: number; showArrow: boolean } | null>(null);
	const [bandStart, setBandStart] = useState(0);
	const [fade, setFade] = useState({ left: false, right: false });

	const trajectory = useTrajectory();

	const bandRef = useRef<HTMLDivElement>(null);
	const drawerRef = useRef<HTMLDivElement>(null);
	const popRef = useRef<HTMLDivElement>(null);
	const rowsRef = useRef<FlatRow[]>([]);

	const summary = useMemo(() => scan(props.records), [props.records]);
	const rows = summary.data;
	const turns = summary.turns;
	const summaryFor = (record: TrajectoryRecord) => turns.find((t) => t.run === record.run && t.turn === record.turn);

	const flatRows = useMemo<FlatRow[]>(() => {
		const out: DisplayRow[] = [];
		for (const record of rows) {
			const presentation = trajectoryNode(record);
			if (presentation.rows !== undefined) {
				let marksPending = record.marks;
				for (let i = 0; i < presentation.rows.length; i += 1) {
					const part = presentation.rows[i]!;
					out.push({
						key: `a:${record.entryId}:${i}`,
						record,
						marks: marksPending || undefined,
						chip: part.chip ?? "MSG",
						tone: part.tone ?? presentation.tone,
						caption: part.caption ?? "",
						details: part.details ?? [],
						...(part.band === undefined ? {} : { band: part.band }),
					});
					marksPending = 0;
				}
				continue;
			}
			out.push({
				key: `r:${record.entryId}`,
				record,
				marks: record.marks,
				chip: presentation.chip,
				tone: presentation.tone,
				caption: presentation.caption,
				details: presentation.details,
				...(presentation.band === undefined ? {} : { band: presentation.band }),
			});
		}
		return out.map((row, i) => ({ ...row, runStart: i === 0 || out[i - 1]!.record.run !== row.record.run }));
	}, [rows]);
	rowsRef.current = flatRows;

	const scroll = useMemo(
		() =>
			createScrollFollower({
				source: (onChange) =>
					trajectory.store.subscribe((state, previous) => {
						if (state.records === previous.records) return;
						onChange(state.records.length === 0);
					}),
				anchor: {
					capture: (el) => rowAnchorAt(el.scrollTop, rowOrigin(el), ROW_H, (index) => rowsRef.current[index]?.key),
					compensate: (el, saved) => {
						const index = rowsRef.current.findIndex((row) => row.key === saved.key);
						return index < 0 ? null : rowAnchorTop(saved, index, rowOrigin(el), ROW_H);
					},
				},
			}),
		[trajectory],
	);

	const virtualizer = useVirtualizer({
		count: flatRows.length,
		estimateSize: () => ROW_H,
		getScrollElement: () => scroll.store.getState().containerEl,
		overscan: 10,
	});

	const virtualItems = virtualizer.getVirtualItems();
	const totalSize = virtualizer.getTotalSize();

	const bandView = useMemo(() => {
		const start = bandStart;
		return { start, rows: flatRows.slice(start, start + BAND_WINDOW), total: flatRows.length };
	}, [flatRows, bandStart]);

	const selectedRow = selectedKey != null ? (flatRows.find((row) => row.key === selectedKey) ?? null) : null;

	const toggleSelect = (row: FlatRow) => {
		setSelectedKey((key) => (key === row.key ? null : row.key));
	};

	const locate = (key: string) => {
		const index = flatRows.findIndex((row) => row.key === key);
		const el = scroll.store.getState().containerEl;
		if (index < 0 || !el) return;
		scroll.seek(rowTopForIndex(index, ROW_H, rowOrigin(el), el.clientHeight));
		setSelectedKey(key);
	};

	const updatePopover = () => {
		const pop = popRef.current;
		const drawer = drawerRef.current;
		if (!selectedKey || !pop || !drawer) {
			setPopStyle(null);
			return;
		}
		const rowEl = document.querySelector(`.traj-all [data-row="${CSS.escape(selectedKey)}"]`);
		const drawerRect = drawer.getBoundingClientRect();
		const drawerHeight = drawer.clientHeight;
		if (!rowEl) {
			setPopStyle((prev) => {
				if (!prev) return null;
				const height = pop.offsetHeight || 240;
				const top = Math.min(Math.max(prev.top, 8), Math.max(8, drawerHeight - height - 8));
				return { ...prev, top, showArrow: false };
			});
			return;
		}
		const rowRect = rowEl.getBoundingClientRect();
		const target = rowRect.top + rowRect.height / 2 - drawerRect.top;
		const rough = Math.min(Math.max(target - 120, 8), Math.max(8, drawerHeight - 240));
		setPopStyle({ top: rough, arrowY: target - rough, showArrow: true });
		requestAnimationFrame(() => {
			if (!popRef.current || selectedKey !== selectedKey) return;
			const height = popRef.current.offsetHeight || 240;
			const top = Math.min(Math.max(target - height / 2, 8), Math.max(8, drawerHeight - height - 8));
			setPopStyle({ top, arrowY: target - top, showArrow: true });
		});
	};

	useEffect(() => {
		if (selectedKey != null) queueMicrotask(updatePopover);
		else setPopStyle(null);
	}, [selectedKey, flatRows]);

	useEffect(() => {
		const onResize = () => updatePopover();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [selectedKey]);

	const checkFade = () => {
		const el = bandRef.current;
		if (!el) return;
		setFade({ left: el.scrollLeft > 1, right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 });
	};

	const onBandScroll = () => {
		if (selectedKey != null) setSelectedKey(null);
		const el = bandRef.current;
		if (!el) return;
		const start = Math.max(0, Math.floor(el.scrollLeft / BAND_COL) - BAND_BUFFER);
		setBandStart(Math.min(start, Math.max(0, flatRows.length - BAND_WINDOW)));
		checkFade();
	};

	useEffect(() => {
		if (!scroll.store.getState().following) return;
		const el = bandRef.current;
		if (el) el.scrollLeft = el.scrollWidth;
		checkFade();
	}, [flatRows, scroll]);

	useEffect(() => {
		const el = bandRef.current;
		if (!el) return;
		const observer = new ResizeObserver(checkFade);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEscapeLayer({
		id: "trajectory.row",
		order: ESCAPE_ORDER.trajectoryRow,
		isOpen: () => selectedKey != null,
		close: () => setSelectedKey(null),
	});

	const loadOlder = () => {
		scroll.hold();
		void props.onLoadOlder();
	};

	const countText =
		props.mode === "slice"
			? `slice · ${props.records.length} nodes shown · ${turns.length} turns`
			: props.mode === "view"
				? `view · ${props.records.length} rows shown`
				: `origin · all ${props.total} entries · ${turns.length} turns`;
	const footText = props.mode === "slice" ? "model context (slice)" : props.mode === "view" ? "chat view" : "whole log · paged";

	const rowColumn = (row: DisplayRow, i: number) => {
		const previous = i > 0 ? flatRows[i - 1]!.record : null;
		const boundary = previous !== null && (previous.run !== row.record.run || previous.turn !== row.record.turn) ? <span className="traj-boundary" /> : null;
		const hot = selectedKey === row.key;
		const title = `R${row.record.run} T${row.record.turn} · ${short(row.caption)}`;
		if (row.band !== undefined) {
			const part = row.band === "tool" ? " tool" : row.band === "think" ? " think" : "";
			return (
				<span key={row.key}>
					{boundary}
					<button
						type="button"
						className={"traj-cell " + (summaryFor(row.record)?.density ?? "l1") + part + (hot ? " hot" : "")}
						data-row={row.key}
						title={title}
						onClick={() => locate(row.key)}
					/>
				</span>
			);
		}
		return (
			<span key={row.key}>
				{boundary}
				<span className={"traj-marker" + (hot ? " hot" : "")} data-row={row.key}>
					<button type="button" className={`traj-tone-${row.tone}`} title={title} onClick={() => locate(row.key)} />
				</span>
			</span>
		);
	};

	const detailBody = (detail: TrajectoryDetail) => {
		const label = detail.label !== undefined && detail.label !== "" ? detail.label : null;
		const description = detail.description !== undefined && detail.description !== "" ? detail.description : null;
		const facts = detail.meta ?? [];
		const head =
			label !== null ? (
				<div className="one-tools">
					<span className="one-tool-name">{label}</span>
					{description !== null ? <span className="one-call-id">{description}</span> : null}
				</div>
			) : description !== null ? (
				<div className="traj-op">{description}</div>
			) : null;
		const factsLine =
			facts.length > 0 ? (
				<div className={"traj-meta" + (detail.error ? " err" : "")}>
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
		if (label !== null) {
			return (
				<details className="one-tool">
					<summary>
						<span className="one-tool-name">{label}</span>
						{facts[0] !== undefined ? <span className="one-call-id">{facts[0]}</span> : null}
					</summary>
					{description !== null ? <p className="one-cap">{description}</p> : null}
					<pre className={"one-args" + (detail.error ? " err" : "")}>{content.value}</pre>
				</details>
			);
		}
		return (
			<>
				{head}
				{factsLine}
				{content.kind === "text" ? (
					<div className={"one-cap" + (detail.error ? " err" : "")}>{content.value}</div>
				) : (
					<pre className={"one-args" + (detail.error ? " err" : "")}>{content.value}</pre>
				)}
			</>
		);
	};

	const listRow = (row: FlatRow, selected: boolean) => (
		<div
			className={"traj-row" + (selected ? " selected" : "") + (row.runStart ? " run-start" : "")}
			data-row={row.key}
			role="button"
			tabIndex={0}
			onClick={() => toggleSelect(row)}
			onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggleSelect(row);
				}
			}}
		>
			{row.marks ? <span className="req-dot" /> : null}
			<button
				type="button"
				className="traj-row-head"
				onClick={(event) => {
					event.stopPropagation();
					toggleSelect(row);
				}}
			>
				<b>{row.chip}</b>
				<span className="row-cap">{short(row.caption)}</span>
			</button>
		</div>
	);

	return (
		<aside className="traj-drawer traj-enter" ref={drawerRef}>
			<div className="traj-head">
				<span className="traj-title">Trajectory</span>
				<div className="traj-mode-toggle" role="group" aria-label="Timeline projection">
					{(["slice", "view"] as const).map((m) => (
						<button
							type="button"
							key={m}
							className={"traj-mode" + (props.mode === m ? " on" : "")}
							onClick={() => props.onModeChange(m)}
							aria-pressed={props.mode === m}
							title={m === "slice" ? "Model context (slice)" : "Chat view"}
						>
							{m}
						</button>
					))}
				</div>
				<button type="button" className="traj-close" title="Close" onClick={props.onClose}>
					×
				</button>
			</div>

			{props.loading && rows.length === 0 ? (
				<div className="traj-empty">loading…</div>
			) : rows.length === 0 ? (
				<div className="traj-empty">no log entries yet — run a conversation first</div>
			) : (
				<>
					<div className="traj-band-wrap">
						<div className="traj-scroll" ref={bandRef} onScroll={onBandScroll}>
							<div
								className="traj-band"
								style={{
									paddingLeft: `${bandStart * BAND_COL}px`,
									paddingRight: `${(bandView.total - bandView.start - bandView.rows.length) * BAND_COL}px`,
								}}
							>
								{bandView.rows.map((row, i) => rowColumn(row, bandView.start + i))}
							</div>
						</div>
						{fade.left && <span className="traj-fade left" />}
						{fade.right && <span className="traj-fade right" />}
					</div>

					<ScrollRegion scroll={scroll} class="traj-all" onScroll={() => selectedKey != null && setSelectedKey(null)}>
						{props.hasMore && (
							<button type="button" className="traj-load-earlier" onClick={loadOlder} disabled={props.loadingOlder}>
								{props.loadingOlder ? "loading…" : "↑ load earlier"}
							</button>
						)}
						<div className={GRID_CLASS} style={{ height: `${totalSize}px`, position: "relative", width: "100%" }}>
							{virtualItems.map((item) => {
								const row = flatRows[item.index];
								return (
									<div key={item.key} style={{ position: "absolute", top: 0, transform: `translateY(${item.start}px)`, width: "100%" }} data-index={item.index}>
										{row ? listRow(row, selectedKey === row.key) : null}
									</div>
								);
							})}
						</div>
					</ScrollRegion>
				</>
			)}

			<div className="traj-foot">
				<span className="traj-count">{props.loading ? "…" : countText}</span>
				<span className="traj-foot-mode">{footText}</span>
			</div>

			{selectedRow != null && (
				<div className={"traj-popover" + (popStyle ? " ready" : "")} ref={popRef} style={{ top: popStyle ? `${popStyle.top}px` : "50%" }}>
					<span className="traj-popover-arrow" style={{ top: `${popStyle?.arrowY ?? 0}px`, display: popStyle?.showArrow === false || !popStyle ? "none" : "block" }} />
					<div className="traj-popover-head">
						<span className="traj-popover-chip">{selectedRow.chip}</span>
						<span className="traj-popover-title">{short(selectedRow.caption)}</span>
						<button type="button" className="traj-popover-close" title="Close" onClick={() => setSelectedKey(null)}>
							×
						</button>
					</div>
					<div className="traj-popover-body">
						{selectedRow.details.map((detail) => (
							<span key={`${selectedRow.key}:${detail.label ?? detail.description ?? ""}`}>{detailBody(detail)}</span>
						))}
						{selectedRow.record.sliceMessage && (
							<div className="traj-raw-section">
								<div className="traj-raw-head">AgentMessage</div>
								<div className="traj-agent-meta">
									<span className="traj-role-chip">{String(selectedRow.record.sliceMessage?.role ?? "")}</span>
									<span className="traj-slice-id">{selectedRow.record.entryId}</span>
								</div>
								<pre className="traj-raw">{stringifyArgs(selectedRow.record.sliceMessage)}</pre>
							</div>
						)}
					</div>
					<div className="traj-popover-meta">
						<div className="traj-id">
							entry {selectedRow.record.entryId} · {fmtDateTime(selectedRow.record.time)}
						</div>
					</div>
				</div>
			)}
		</aside>
	);
}
