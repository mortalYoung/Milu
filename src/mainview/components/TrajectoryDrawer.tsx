import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { stringifyArgs, type TrajectoryDetail, type TrajectoryTone, trajectoryNode } from "../../shared/entry-meta";
import type { TrajectoryRecord } from "../../shared/rpc";
import { type TimelineNode, timelineNodes } from "../../shared/trajectory";
import { useSession } from "../lib/contexts/session-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import type { TrajectoryMode } from "../lib/trajectory";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDateTime = (ts: number) => {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const short = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);

type DisplayRow = {
	key: string;
	node: TimelineNode;
	marks?: number;
	chip: string;
	tone: TrajectoryTone;
	caption: string;
	details: TrajectoryDetail[];
	band?: "cell" | "tool" | "think";
};

/** Virtual-list row: a content row with the run-start boundary flag. */
type FlatRow = DisplayRow & { runStart: boolean };

const ROW_H = 28;

export function TrajectoryDrawer() {
	const trajectory = useTrajectory();
	const session = useSession();
	return (
		<Show when={trajectory.data.open()}>
			<DrawerContent
				records={trajectory.data.records()}
				total={session.data.origin.total}
				mode={trajectory.data.mode()}
				onModeChange={trajectory.mutate.changeMode}
				loading={session.data.origin.loading}
				hasMore={session.data.origin.hasMore}
				loadingOlder={session.data.origin.loading}
				onLoadOlder={() => session.mutate.originLoadMore()}
				onClose={() => trajectory.mutate.setOpen(false)}
			/>
		</Show>
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
	const [selectedKey, setSelectedKey] = createSignal<string | null>(null);

	const summary = createMemo(() => timelineNodes(props.records));
	const nodes = () => summary().nodes;
	const rows = () => nodes();
	const turns = () => summary().turns;
	const summaryFor = (n: TimelineNode) => turns().find((t) => t.run === n.record.run && t.turn === n.record.turn);
	const countText = () =>
		props.mode === "slice"
			? `slice · ${props.records.length} nodes shown · ${turns().length} turns`
			: props.mode === "view"
				? `view · ${props.records.length} rows shown`
				: `origin · all ${props.total} entries · ${turns().length} turns`;
	const footText = () => (props.mode === "slice" ? "model context (slice)" : props.mode === "view" ? "chat view" : "whole log · paged");

	const flatRows = createMemo<FlatRow[]>(() => {
		const out: DisplayRow[] = [];
		for (const n of rows()) {
			const presentation = trajectoryNode(n.record);
			if (presentation.rows !== undefined) {
				let marksPending = n.requestMarks;
				for (let i = 0; i < presentation.rows.length; i += 1) {
					const part = presentation.rows[i];
					out.push({
						key: `a:${n.seq}:${i}`,
						node: n,
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
				key: `r:${n.seq}`,
				node: n,
				marks: n.requestMarks,
				chip: presentation.chip,
				tone: presentation.tone,
				caption: presentation.caption,
				details: presentation.details,
				...(presentation.band === undefined ? {} : { band: presentation.band }),
			});
		}
		return out.map((row, i) => ({ ...row, runStart: i === 0 || out[i - 1].node.record.run !== row.node.record.run }));
	});

	let listRef: HTMLDivElement | undefined;
	const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
		enabled: true,
		get count() {
			return flatRows().length;
		},
		estimateSize: () => ROW_H,
		getScrollElement: () => listRef ?? null,
		overscan: 10,
	});

	const toggleSelect = (row: FlatRow) => {
		setSelectedKey((k) => (k === row.key ? null : row.key));
	};
	const locate = (key: string) => {
		const idx = flatRows().findIndex((r) => r.key === key);
		if (idx < 0) return;
		virtualizer.scrollToIndex(idx, { align: "center" });
		setSelectedKey(key);
	};
	const selectedRow = () => (selectedKey() != null ? (flatRows().find((r) => r.key === selectedKey()) ?? null) : null);

	let drawerRef: HTMLDivElement | undefined;
	let popRef: HTMLDivElement | undefined;
	const [popStyle, setPopStyle] = createSignal<{ top: number; arrowY: number; showArrow: boolean } | null>(null);
	const updatePopover = () => {
		const key = selectedKey();
		const pop = popRef;
		const drawer = drawerRef;
		if (!key || !pop || !drawer) {
			setPopStyle(null);
			return;
		}
		const rowEl = document.querySelector(`.traj-all [data-row="${CSS.escape(key)}"]`);
		const dRect = drawer.getBoundingClientRect();
		const dH = drawer.clientHeight;
		if (!rowEl) {
			setPopStyle((prev) => {
				if (!prev) return null;
				const h = pop.offsetHeight || 240;
				const top = Math.min(Math.max(prev.top, 8), Math.max(8, dH - h - 8));
				return { ...prev, top, showArrow: false };
			});
			return;
		}
		const rowRect = rowEl.getBoundingClientRect();
		const target = rowRect.top + rowRect.height / 2 - dRect.top;
		const rough = Math.min(Math.max(target - 120, 8), Math.max(8, dH - 240));
		setPopStyle({ top: rough, arrowY: target - rough, showArrow: true });
		requestAnimationFrame(() => {
			if (!popRef || selectedKey() !== key) return;
			const h = popRef.offsetHeight || 240;
			const top = Math.min(Math.max(target - h / 2, 8), Math.max(8, dH - h - 8));
			setPopStyle({ top, arrowY: target - top, showArrow: true });
		});
	};
	createEffect(() => {
		if (selectedKey() != null) queueMicrotask(updatePopover);
		else setPopStyle(null);
	});
	createEffect(() => {
		window.addEventListener("resize", updatePopover);
		return () => window.removeEventListener("resize", updatePopover);
	});

	let bandRef: HTMLDivElement | undefined;
	const [fade, setFade] = createSignal({ left: false, right: false });
	const checkFade = () => {
		if (!bandRef) return;
		setFade({ left: bandRef.scrollLeft > 1, right: bandRef.scrollLeft < bandRef.scrollWidth - bandRef.clientWidth - 1 });
	};

	const BAND_COL = 18;
	const BAND_WINDOW = 80;
	const BAND_BUFFER = 30;
	const [bandStart, setBandStart] = createSignal(0);
	const bandView = createMemo(() => {
		const all = flatRows();
		const start = bandStart();
		return { start, rows: all.slice(start, start + BAND_WINDOW), total: all.length };
	});
	const onBandScroll = () => {
		if (selectedKey() != null) setSelectedKey(null);
		const el = bandRef;
		if (!el) return;
		const start = Math.max(0, Math.floor(el.scrollLeft / BAND_COL) - BAND_BUFFER);
		setBandStart(Math.min(start, Math.max(0, flatRows().length - BAND_WINDOW)));
		checkFade();
	};

	let suppressAutoScroll = false;

	createEffect(() => {
		nodes();
		if (suppressAutoScroll) return;
		if (bandRef) bandRef.scrollLeft = bandRef.scrollWidth;
		checkFade();
		const scrollBottom = () => {
			if (flatRows().length > 0) virtualizer.scrollToIndex(flatRows().length - 1, { align: "end" });
		};
		queueMicrotask(scrollBottom);
		requestAnimationFrame(scrollBottom);
	});
	createEffect(() => {
		if (!bandRef) return;
		const ro = new ResizeObserver(checkFade);
		ro.observe(bandRef);
		return () => ro.disconnect();
	});

	createEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (selectedKey() != null) setSelectedKey(null);
			else props.onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const loadOlderKeep = async () => {
		suppressAutoScroll = true;
		try {
			const el = listRef;
			const before = el?.scrollTop ?? 0;
			const countBefore = flatRows().length;
			await props.onLoadOlder();
			queueMicrotask(() => {
				if (!listRef) return;
				listRef.scrollTop = before + (flatRows().length - countBefore) * ROW_H;
			});
		} finally {
			suppressAutoScroll = false;
		}
	};

	const rowColumn = (row: DisplayRow, i: number) => {
		const n = row.node;
		const previous = i > 0 ? flatRows()[i - 1].node.record : null;
		const boundary = previous !== null && (previous.run !== n.record.run || previous.turn !== n.record.turn) ? <span class="traj-boundary" /> : null;
		const hot = selectedKey() === row.key;
		const title = `R${n.record.run} T${n.record.turn} · ${short(row.caption)}`;
		if (row.band !== undefined) {
			const part = row.band === "tool" ? " tool" : row.band === "think" ? " think" : "";
			return (
				<>
					{boundary}
					<button class={"traj-cell " + (summaryFor(n)?.density ?? "l1") + part + (hot ? " hot" : "")} data-row={row.key} title={title} onClick={() => locate(row.key)} />
				</>
			);
		}
		return (
			<>
				{boundary}
				<span class={"traj-marker" + (hot ? " hot" : "")} data-row={row.key}>
					<button class={`traj-tone-${row.tone}`} title={title} onClick={() => locate(row.key)} />
				</span>
			</>
		);
	};

	const bodyMeta = (n: TimelineNode) => (
		<div class="traj-id">
			entry {n.record.entryId} · {fmtDateTime(n.record.time)}
		</div>
	);

	const detailBody = (detail: TrajectoryDetail) => {
		const label = detail.label !== undefined && detail.label !== "" ? detail.label : null;
		const description = detail.description !== undefined && detail.description !== "" ? detail.description : null;
		const facts = detail.meta ?? [];
		const head =
			label !== null ? (
				<div class="one-tools">
					<span class="one-tool-name">{label}</span>
					{description !== null ? <span class="one-call-id">{description}</span> : null}
				</div>
			) : description !== null ? (
				<div class="traj-op">{description}</div>
			) : null;
		const factsLine =
			facts.length > 0 ? (
				<div class={"traj-meta" + (detail.error ? " err" : "")}>
					<For each={facts}>{(fact) => <span>{fact}</span>}</For>
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
				<details class="one-tool">
					<summary>
						<span class="one-tool-name">{label}</span>
						{facts[0] !== undefined ? <span class="one-call-id">{facts[0]}</span> : null}
					</summary>
					{description !== null ? <p class="one-cap">{description}</p> : null}
					<pre class={"one-args" + (detail.error ? " err" : "")}>{content.value}</pre>
				</details>
			);
		}
		return (
			<>
				{head}
				{factsLine}
				{content.kind === "text" ? (
					<div class={"one-cap" + (detail.error ? " err" : "")}>{content.value}</div>
				) : (
					<pre class={"one-args" + (detail.error ? " err" : "")}>{content.value}</pre>
				)}
			</>
		);
	};

	const detailsBody = (details: TrajectoryDetail[]) => <For each={details}>{(detail) => detailBody(detail)}</For>;

	const rowBody = (row: DisplayRow) => <>{detailsBody(row.details)}</>;

	const listRow = (row: FlatRow) => {
		const selected = selectedKey() === row.key;
		return (
			<div
				class={"traj-row" + (selected ? " selected" : "") + (row.runStart ? " run-start" : "")}
				data-row={row.key}
				role="button"
				tabindex="0"
				onClick={() => toggleSelect(row)}
				onKeyDown={(e) => {
					if (e.target !== e.currentTarget) return;
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						toggleSelect(row);
					}
				}}
			>
				{row.marks ? <span class="req-dot" /> : null}
				<button
					type="button"
					class="traj-row-head"
					onClick={(e) => {
						e.stopPropagation();
						toggleSelect(row);
					}}
				>
					<b>{row.chip}</b>
					<span class="row-cap">{short(row.caption)}</span>
				</button>
			</div>
		);
	};

	return (
		<>
			<aside class="traj-drawer traj-enter" ref={drawerRef}>
				<div class="traj-head">
					<span class="traj-title">Trajectory</span>
					<div class="traj-mode-toggle" role="group" aria-label="Timeline projection">
						{(["slice", "view"] as const).map((m) => (
							<button
								type="button"
								class={"traj-mode" + (props.mode === m ? " on" : "")}
								onClick={() => props.onModeChange(m)}
								aria-pressed={props.mode === m}
								title={m === "slice" ? "Model context (slice)" : "Chat view"}
							>
								{m}
							</button>
						))}
					</div>
					<button class="traj-close" title="Close" onClick={props.onClose}>
						×
					</button>
				</div>

				{props.loading && nodes().length === 0 ? (
					<div class="traj-empty">loading…</div>
				) : nodes().length === 0 ? (
					<div class="traj-empty">no log entries yet — run a conversation first</div>
				) : (
					<>
						<div class="traj-band-wrap">
							<div class="traj-scroll" ref={bandRef} onScroll={onBandScroll}>
								<div
									class="traj-band"
									style={{ "padding-left": `${bandStart() * BAND_COL}px`, "padding-right": `${(bandView().total - bandView().start - bandView().rows.length) * BAND_COL}px` }}
								>
									<For each={bandView().rows}>{(row, i) => rowColumn(row, bandView().start + i())}</For>
								</div>
							</div>
							<Show when={fade().left}>
								<span class="traj-fade left" />
							</Show>
							<Show when={fade().right}>
								<span class="traj-fade right" />
							</Show>
						</div>

						<div
							class="traj-all"
							ref={listRef}
							onScroll={() => {
								if (selectedKey() != null) setSelectedKey(null);
							}}
						>
							<Show when={props.hasMore}>
								<button type="button" class="traj-load-earlier" onClick={() => void loadOlderKeep()} disabled={props.loadingOlder}>
									{props.loadingOlder ? "loading…" : "↑ load earlier"}
								</button>
							</Show>
							<div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
								<For each={virtualizer.getVirtualItems()}>
									{(item) => {
										const row = flatRows()[item.index];
										return (
											<div style={{ position: "absolute", top: 0, transform: `translateY(${item.start}px)`, width: "100%" }} data-index={item.index}>
												{row ? listRow(row) : null}
											</div>
										);
									}}
								</For>
							</div>
						</div>
					</>
				)}

				<div class="traj-foot">
					<span class="traj-count">{props.loading ? "…" : countText()}</span>
					<span class="traj-foot-mode">{footText()}</span>
				</div>

				<Show when={selectedRow() != null}>
					<div class={"traj-popover" + (popStyle() ? " ready" : "")} ref={popRef} style={{ top: popStyle() ? `${popStyle()!.top}px` : "50%" }}>
						<span class="traj-popover-arrow" style={{ top: `${popStyle()?.arrowY ?? 0}px`, display: popStyle()?.showArrow === false || !popStyle() ? "none" : "block" }} />
						<div class="traj-popover-head">
							<span class="traj-popover-chip">{selectedRow()!.chip}</span>
							<span class="traj-popover-title">{short(selectedRow()!.caption)}</span>
							<button type="button" class="traj-popover-close" title="Close" onClick={() => setSelectedKey(null)}>
								×
							</button>
						</div>
						<div class="traj-popover-body">
							{rowBody(selectedRow()!)}
							<Show when={selectedRow()!.node.record.sliceMessage}>
								<div class="traj-raw-section">
									<div class="traj-raw-head">AgentMessage</div>
									<div class="traj-agent-meta">
										<span class="traj-role-chip">{String(selectedRow()?.node.record.sliceMessage?.role ?? "")}</span>
										<span class="traj-slice-id">{selectedRow()!.node.record.entryId}</span>
									</div>
									<pre class="traj-raw">{stringifyArgs(selectedRow()!.node.record.sliceMessage)}</pre>
								</div>
							</Show>
						</div>
						<div class="traj-popover-meta">{bodyMeta(selectedRow()!.node)}</div>
					</div>
				</Show>
			</aside>
		</>
	);
}
