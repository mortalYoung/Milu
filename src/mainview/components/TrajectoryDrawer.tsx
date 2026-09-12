import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { TrajectoryBlock, TrajectoryRecord, TrajectoryUsage } from "../../shared/rpc";
import { stringifyArgs, type TimelineNode, timelineNodes } from "../../shared/trajectory";
import { useSession } from "../lib/contexts/session-context";
import { useTrajectory } from "../lib/contexts/trajectory-context";
import type { TrajectoryMode } from "../lib/trajectory";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtDateTime = (ts: number) => {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const fmtTok = (n: number | undefined) => (n && n > 0 ? n.toLocaleString() : "—");
const short = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);
const firstLine = (s: string) => s.split("\n").find((l) => l.trim()) ?? "";

const json = (v: unknown): string => {
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return String(v);
	}
};

const dataText = (data: unknown): string => {
	const d = data as { text?: unknown } | null;
	return typeof d?.text === "string" ? d.text : "";
};

const textBlocks = (blocks: TrajectoryBlock[]): string[] => blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? ""));

const fmtUsage = (u: TrajectoryUsage | undefined) =>
	u
		? `in ${fmtTok(u.input)} · out ${fmtTok(u.output)} · cacheRead ${fmtTok(u.cacheRead)} · cacheWrite ${fmtTok(u.cacheWrite)}${u.reasoning ? ` · reasoning ${fmtTok(u.reasoning)}` : ""} tok`
		: "";

function markerClass(record: TrajectoryRecord): string | null {
	switch (record.kind) {
		case "assistant":
			return null;
		case "user":
			return record.skillName ? "mskill" : "mq";
		case "toolResult":
			return "mres";
		case "modelChange":
		case "activeTools":
			return "mchange";
		case "compaction":
		case "branchSummary":
			return "mcompact";
		case "custom":
			switch (record.customType) {
				case "send_message":
					return "mmsg";
				case "system_prompt":
					return "msys";
				case "system_reminder":
					return "mrm";
				case "request/header":
				case "escalation/request":
					return "mreq";
				case "escalation/decision":
					return "mres";
				default:
					return "mcustom";
			}
	}
}

function chipLabel(record: TrajectoryRecord): string {
	switch (record.kind) {
		case "user":
			return record.skillName ? "SKILL" : "Q";
		case "assistant":
			return "MSG";
		case "toolResult":
			return "RES";
		case "modelChange":
			return "MOD";
		case "activeTools":
			return "TOOLS";
		case "compaction":
			return "CMP";
		case "branchSummary":
			return "BR";
		case "custom":
			switch (record.customType) {
				case "send_message":
					return "SEND";
				case "system_prompt":
					return "SYS";
				case "system_reminder":
					return "RM";
				case "request/header":
					return "HDR";
				case "surface_op":
					return "OP";
				case "compaction_summary":
					return "SUM";
				case "compaction/start":
					return "START";
				case "compaction/end":
					return "END";
				case "escalation/request":
					return "ESC";
				case "escalation/decision":
					return "DEC";
				default:
					return "CUSTOM";
			}
	}
}

function rowCaption(record: TrajectoryRecord): string {
	switch (record.kind) {
		case "user":
			return firstLine(record.content);
		case "assistant": {
			const text = firstLine(textBlocks(record.blocks).join("\n"));
			const tool = record.blocks.find((b) => b.type === "toolCall");
			return text || (tool ? String(tool.name ?? "") : "assistant");
		}
		case "toolResult":
			return firstLine(record.content) || record.toolName;
		case "modelChange":
			return `${record.provider} → ${record.modelId}`;
		case "activeTools":
			return record.activeToolNames.join(", ");
		case "compaction":
			return firstLine(record.summary) || "compaction";
		case "branchSummary":
			return firstLine(record.summary) || "branch summary";
		case "custom":
			switch (record.customType) {
				case "send_message":
					return firstLine(dataText(record.data));
				case "system_prompt":
					return "System prompt";
				case "system_reminder":
					return firstLine(dataText(record.data));
				case "surface_op": {
					const op = record.data as { start?: number; end?: number; replaceGeneration?: number } | null;
					return op ? `replace [${op.start}..${op.end}] · gen ${op.replaceGeneration ?? "?"}` : "surface op";
				}
				case "compaction_summary":
					return firstLine(dataText(record.data));
				case "compaction/start":
					return "compaction start";
				case "compaction/end":
					return "compaction end";
				case "request/header": {
					const h = record.data as { tools?: unknown; toolNames?: unknown } | null;
					const tools = Array.isArray(h?.tools) ? h.tools.filter((t): t is { name?: unknown } => !!t && typeof t === "object") : [];
					const names = tools.length > 0 ? tools.map((t) => String(t.name ?? "")) : Array.isArray(h?.toolNames) ? h.toolNames.map((n) => String(n)) : [];
					return names.length > 0 ? `${names.join(", ")} · ${names.length} tool${names.length === 1 ? "" : "s"}` : "request header";
				}
				default:
					return record.customType;
			}
	}
}

function rowClass(record: TrajectoryRecord): string {
	switch (record.kind) {
		case "modelChange":
		case "activeTools":
			return "change";
		case "compaction":
		case "branchSummary":
			return "compact";
		case "custom":
			switch (record.customType) {
				case "system_prompt":
					return "sys";
				case "system_reminder":
					return "rm";
				case "surface_op":
				case "compaction_summary":
				case "compaction/start":
				case "compaction/end":
				case "request/header":
					return "compact";
				default:
					return "custom";
			}
	}
	return "";
}

type DisplayRow = { key: string; node: TimelineNode; marks?: number } & (
	| { kind: "row" }
	| { kind: "assistant"; textBlocks: TrajectoryBlock[]; otherBlocks: TrajectoryBlock[] }
	| { kind: "thinking"; block: TrajectoryBlock }
	| { kind: "tool"; block: TrajectoryBlock; callId: string; result?: { text: string; isError: boolean } }
	| { kind: "stepLabel" }
);

interface RunSection {
	turn: number;
	reason: string;
	error: string;
	rows: DisplayRow[];
}

/** Virtual-list row: a content row with the run-start boundary flag. */
type FlatRow = DisplayRow & { runStart: boolean };

const ROW_H = 28;

export function TrajectoryDrawer() {
	const trajectory = useTrajectory();
	const session = useSession();
	const running = () => {
		const name = session.data.selected;
		return name ? (session.data.partners.find((p) => p.name === name)?.writing ?? false) : false;
	};
	return (
		<Show when={trajectory.data.open()}>
			<DrawerContent
				records={trajectory.data.records()}
				total={session.data.origin.total}
				running={running()}
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
	running: boolean;
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
	const rows = () => nodes().filter((n) => !n.positionOnly);
	const turns = () => summary().turns;
	const turnOf = (n: TimelineNode) => turns().find((t) => t.turn === n.turn);
	const lastTurn = () => turns().at(-1)?.turn ?? 0;
	const inFlight = (row: Extract<DisplayRow, { kind: "tool" }>) => props.running && row.node.turn === lastTurn();
	const countText = () =>
		props.mode === "slice"
			? `slice · ${props.records.length} nodes shown · ${turns().length} turns`
			: props.mode === "view"
				? `view · ${props.records.length} rows shown`
				: `origin · all ${props.total} entries · ${turns().length} turns`;
	const footText = () => (props.mode === "slice" ? "model context (slice)" : props.mode === "view" ? "chat view" : "whole log · paged");

	const sections = createMemo<{ sections: RunSection[]; seqTurn: Map<number, number> }>(() => {
		const all: RunSection[] = [];
		const seqTurn = new Map<number, number>();
		let current: RunSection | null = null;
		let closed = true;
		let pendingCalls = new Map<string, number>();
		const push = (row: DisplayRow) => {
			if (!current) {
				current = { turn: 1, reason: "", error: "", rows: [] };
				all.push(current);
				closed = false;
			}
			current.rows.push(row);
			seqTurn.set(row.node.seq, current.turn);
		};
		const pushIndex = (row: DisplayRow) => {
			push(row);
			return current!.rows.length - 1;
		};
		for (const n of rows()) {
			const r = n.record;
			if (r.kind === "custom" && (r.customType === "turn/start" || r.customType === "turn/end" || r.customType === "step/start" || r.customType === "step/end")) {
				const data = (r.data ?? {}) as { turn?: unknown; step?: unknown; reason?: unknown; error?: unknown };
				if (r.customType === "turn/start") {
					if (!current || closed) {
						current = { turn: typeof data.turn === "number" ? data.turn : (all.at(-1)?.turn ?? 0) + 1, reason: "", error: "", rows: [] };
						all.push(current);
						closed = false;
					}
				} else if (r.customType === "step/start") {
					if (!current || closed) {
						current = { turn: (all.at(-1)?.turn ?? 0) + 1, reason: "", error: "", rows: [] };
						all.push(current);
						closed = false;
					}
					current.rows.push({ key: `sl:${n.seq}`, node: n, kind: "stepLabel" });
				} else if (r.customType === "turn/end") {
					if (current && typeof data.turn === "number" && current.turn === data.turn) {
						current.reason = String(data.reason ?? "completed");
						if (typeof data.error === "string") current.error = data.error;
					}
					closed = true;
				}
				continue;
			}
			if (r.kind === "user") {
				if (!current || closed) {
					const next = rows().find((m) => m.seq > n.seq && m.record.kind === "custom" && m.record.customType === "turn/start");
					const nextData = (next?.record.kind === "custom" ? (next.record.data ?? {}) : {}) as { turn?: unknown };
					current = { turn: next && typeof nextData.turn === "number" ? nextData.turn : (all.at(-1)?.turn ?? 0) + 1, reason: "", error: "", rows: [] };
					all.push(current);
					closed = false;
				}
			}
			if (r.kind === "assistant") {
				const headKey = `a:${n.seq}`;
				const textBlocksArr = r.blocks.filter((b) => b.type === "text");
				let marksPending = n.requestMarks;
				const pushPart = (row: DisplayRow) => {
					pushIndex(row);
					marksPending = 0;
				};
				for (const b of r.blocks) {
					if (b.type !== "thinking") continue;
					pushPart({ key: `${headKey}:think:${current?.rows.length ?? 0}`, node: n, marks: marksPending || undefined, kind: "thinking", block: b });
				}
				pendingCalls = new Map();
				for (const b of r.blocks) {
					if (b.type !== "toolCall") continue;
					const at = current?.rows.length ?? 0;
					const idx = pushIndex({ key: `${headKey}:tool:${at}`, node: n, marks: marksPending || undefined, kind: "tool", block: b, callId: String(b.id ?? "") });
					if (typeof b.id === "string") pendingCalls.set(b.id, idx);
				}
				if (textBlocksArr.length > 0) {
					push({
						key: headKey,
						node: n,
						marks: marksPending || undefined,
						kind: "assistant",
						textBlocks: textBlocksArr,
						otherBlocks: r.blocks.filter((b) => b.type !== "text" && b.type !== "toolCall" && b.type !== "thinking"),
					});
				}
				continue;
			}
			if (r.kind === "toolResult") {
				const target = pendingCalls.get(r.toolCallId);
				if (current && target != null && current.rows[target].kind === "tool") {
					const merged = current.rows[target];
					if (merged.kind === "tool") {
						current.rows[target] = { ...merged, result: { text: r.content, isError: r.isError }, marks: (merged.marks ?? 0) + (n.requestMarks ?? 0) };
					}
				} else {
					push({ key: `r:${n.seq}`, node: n, marks: n.requestMarks, kind: "row" });
				}
				continue;
			}
			// harness-delivery send_messages duplicate the assistant text already shown by the
			// assistant row in origin/slice modes. In view mode that assistant row is filtered
			// out, so the heartbeat IS the only chat-visible reply and must stay.
			if (props.mode !== "view" && r.kind === "custom" && r.customType === "send_message" && (r.data as { toolCallId?: unknown } | null)?.toolCallId === "harness-delivery") {
				continue;
			}
			if (r.kind === "custom" && r.customType === "tool/call") {
				continue;
			}
			push({ key: `r:${n.seq}`, node: n, marks: n.requestMarks, kind: "row" });
		}
		return { sections: all, seqTurn };
	});

	const flatRows = createMemo<FlatRow[]>(() => {
		const out: FlatRow[] = [];
		for (const sec of sections().sections) {
			let first = true;
			for (const row of sec.rows) {
				if (row.kind === "stepLabel") continue;
				out.push({ ...row, runStart: first });
				first = false;
			}
		}
		return out;
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
		const boundary = i > 0 && flatRows()[i - 1].node.turn !== n.turn ? <span class="traj-boundary" /> : null;
		const hot = selectedKey() === row.key;
		const title = `T${n.turn} · ${short(captionFor(row))}`;
		if (row.kind === "assistant" || row.kind === "tool" || row.kind === "thinking") {
			const t = turnOf(n);
			const part = row.kind === "tool" ? " tool" : row.kind === "thinking" ? " think" : "";
			return (
				<>
					{boundary}
					<button class={"traj-cell " + (t?.density ?? "l1") + part + (hot ? " hot" : "")} data-row={row.key} title={title} onClick={() => locate(row.key)} />
				</>
			);
		}
		const marker = markerClass(n.record);
		return (
			<>
				{boundary}
				<span class={"traj-marker" + (hot ? " hot" : "")} data-row={row.key}>
					<button class={marker ?? "mcustom"} title={title} onClick={() => locate(row.key)} />
				</span>
			</>
		);
	};

	const rowClassFor = (row: DisplayRow) => {
		if (row.kind === "thinking") return "think";
		if (row.kind === "tool") return "tool";
		return rowClass(row.node.record);
	};
	const chipFor = (row: DisplayRow) => {
		if (row.kind === "thinking") return "THINK";
		if (row.kind === "tool") return "TOOL";
		return chipLabel(row.node.record);
	};
	const captionFor = (row: DisplayRow) => {
		if (row.kind === "thinking") return firstLine(String(row.block.thinking ?? ""));
		if (row.kind === "tool") {
			const name = String(row.block.name ?? "");
			const raw = row.block.arguments;
			const args =
				typeof raw === "string"
					? firstLine(raw)
					: (() => {
							try {
								return JSON.stringify(raw).replace(/\s+/g, " ").trim();
							} catch {
								return String(raw);
							}
						})();
			return args ? `${name} · ${args}` : name;
		}
		if (row.kind === "assistant") return firstLine(textBlocks(row.textBlocks).join("\n")) || "assistant";
		return rowCaption(row.node.record);
	};

	const bodyMeta = (n: TimelineNode) => (
		<div class="traj-id">
			entry {n.record.entryId} · {fmtDateTime(n.record.time)}
		</div>
	);

	const thinkingBody = (row: Extract<DisplayRow, { kind: "thinking" }>) => {
		const b = row.block;
		return (
			<>
				<div class="one-think-label">
					thinking
					{typeof b.redacted === "boolean" && b.redacted ? ` · redacted${typeof b.thoughtSignature === "string" ? ` · ${String(b.thoughtSignature)}` : ""}` : ""}
				</div>
				<p class="one-thinking">{String(b.thinking ?? "")}</p>
			</>
		);
	};

	const toolBody = (row: Extract<DisplayRow, { kind: "tool" }>) => (
		<div class="one-tools">
			<span class="one-tool-name">{String(row.block.name ?? "")}</span>
			{row.callId && <span class="one-call-id">{row.callId}</span>}
			<pre class="one-args">{stringifyArgs(row.block.arguments)}</pre>
			{row.result ? (
				<pre class={"one-args" + (row.result.isError ? " err" : "")}>{row.result.text}</pre>
			) : inFlight(row) ? (
				<span class="traj-running">(running)</span>
			) : (
				<span class="traj-interrupted">(interrupted)</span>
			)}
		</div>
	);

	const assistantBody = (row: Extract<DisplayRow, { kind: "assistant" }>) => {
		const r = row.node.record;
		if (r.kind !== "assistant") return null;
		return (
			<>
				<For each={row.textBlocks}>{(b) => <div class="one-cap">{String(b.text ?? "")}</div>}</For>
				<For each={row.otherBlocks}>{(b) => <pre class="one-args">{json(b)}</pre>}</For>
				<div class="traj-meta">
					<span>{r.model}</span>
					<span>
						{r.provider} · {r.api}
					</span>
					<span>stop: {r.stopReason}</span>
					{r.responseModel && <span>responseModel {r.responseModel}</span>}
					{r.responseId && <span>response {r.responseId}</span>}
					<span>{fmtUsage(r.usage)}</span>
					{r.errorMessage && <span class="err">{r.errorMessage}</span>}
				</div>
			</>
		);
	};

	const rowBody = (row: DisplayRow) => {
		if (row.kind === "thinking") return thinkingBody(row);
		if (row.kind === "tool") return toolBody(row);
		if (row.kind === "assistant") return assistantBody(row);
		return nodeBody(row.node);
	};

	const nodeBody = (n: TimelineNode) => {
		const r = n.record;
		switch (r.kind) {
			case "user":
				return <div class="one-cap">{r.content}</div>;
			case "toolResult":
				return (
					<>
						<pre class={"one-args" + (r.isError ? " err" : "")}>{r.content || "(no output)"}</pre>
						<div class="traj-meta">
							<span>call {r.toolCallId}</span>
							<span>{r.toolName}</span>
							<span>{r.isError ? "error" : "ok"}</span>
							{r.addedToolNames?.length ? <span>tools added: {r.addedToolNames.join(", ")}</span> : null}
							<span>{fmtUsage(r.usage)}</span>
						</div>
						{r.details != null && <pre class="one-args">{json(r.details)}</pre>}
					</>
				);
			case "modelChange":
				return (
					<div class="traj-meta">
						<span>{r.provider}</span>
						<span>→ {r.modelId}</span>
					</div>
				);
			case "activeTools":
				return (
					<div class="one-tools">
						<For each={r.activeToolNames}>{(name) => <span class="one-tool-name">{name}</span>}</For>
					</div>
				);
			case "compaction":
				return (
					<>
						<div class="one-cap">{r.summary || "(empty summary)"}</div>
						<div class="traj-meta">
							<span>{fmtTok(r.tokensBefore)} tok before</span>
							<span>{r.retainedTailCount} retained messages</span>
							<span>{fmtUsage(r.usage)}</span>
						</div>
						{r.details != null && <pre class="one-args">{json(r.details)}</pre>}
					</>
				);
			case "branchSummary":
				return (
					<>
						<div class="one-cap">{r.summary || "(empty summary)"}</div>
						<div class="traj-meta">
							<span>from {r.fromId}</span>
							<span>{fmtUsage(r.usage)}</span>
						</div>
						{r.details != null && <pre class="one-args">{json(r.details)}</pre>}
					</>
				);
			case "custom":
				switch (r.customType) {
					case "send_message":
						return <div class="one-cap">{dataText(r.data)}</div>;
					case "system_prompt":
					case "compaction_summary":
						return <pre class="one-args">{dataText(r.data)}</pre>;
					case "system_reminder":
						return <div class="one-cap">{dataText(r.data)}</div>;
					case "surface_op": {
						const d = (r.data ?? {}) as { op?: string; start?: number; end?: number; sourceEventSeqs?: unknown; replaceGeneration?: number; checkpointId?: unknown };
						return (
							<>
								<div class="traj-op">
									replace surface nodes [{d.start ?? "?"}..{d.end ?? "?"}] · shadowed {Array.isArray(d.sourceEventSeqs) ? d.sourceEventSeqs.length : "?"} · generation{" "}
									{d.replaceGeneration ?? "?"}
									{d.checkpointId != null && <span> · checkpoint {String(d.checkpointId)}</span>}
								</div>
								<pre class="one-args">{json(r.data)}</pre>
							</>
						);
					}
					case "compaction/start":
					case "compaction/end":
						return <pre class="one-args">{json(r.data)}</pre>;
					case "request/header": {
						const d = (r.data ?? {}) as { tools?: unknown; toolNames?: unknown };
						const tools = Array.isArray(d.tools)
							? d.tools.filter((t): t is { name?: unknown; label?: unknown; description?: unknown; parameters?: unknown } => !!t && typeof t === "object")
							: [];
						if (tools.length === 0) {
							const names = Array.isArray(d.toolNames) ? d.toolNames : [];
							return (
								<div class="one-tools">
									<For each={names}>{(name) => <span class="one-tool-name">{String(name)}</span>}</For>
								</div>
							);
						}
						return (
							<div class="one-tools">
								<For each={tools}>
									{(raw) => (
										<details class="one-tool">
											<summary>
												<span class="one-tool-name">{String(raw.name ?? "")}</span>
												{raw.label ? <span class="one-call-id">{String(raw.label)}</span> : null}
											</summary>
											{raw.description ? <p class="one-cap">{String(raw.description)}</p> : null}
											{raw.parameters != null ? <pre class="one-args">{json(raw.parameters)}</pre> : null}
										</details>
									)}
								</For>
							</div>
						);
					}
					case "escalation/request": {
						const d = (r.data ?? {}) as { escalationId?: unknown; command?: unknown; from?: unknown; to?: unknown; justification?: unknown };
						return (
							<>
								<div class="one-tools">
									<span class="one-tool-name">escalation</span>
									{d.escalationId != null && <span class="one-call-id">{String(d.escalationId)}</span>}
								</div>
								<pre class="one-args">{String(d.command ?? "")}</pre>
								<div class="traj-meta">
									<span>
										{String(d.from ?? "")} → {String(d.to ?? "")}
									</span>
									{d.justification ? <span>{String(d.justification)}</span> : null}
								</div>
							</>
						);
					}
					case "escalation/decision": {
						const d = (r.data ?? {}) as { escalationId?: unknown; approved?: unknown };
						return (
							<div class="traj-meta">
								<span>{d.approved === true ? "approved" : "rejected"}</span>
								{d.escalationId != null && <span>{String(d.escalationId)}</span>}
							</div>
						);
					}
					default:
						return <pre class="one-args">{json(r.data)}</pre>;
				}
		}
	};

	const listRow = (row: FlatRow) => {
		const selected = selectedKey() === row.key;
		return (
			<div
				class={"traj-row" + (rowClassFor(row) ? " " + rowClassFor(row) : "") + (selected ? " selected" : "") + (row.runStart ? " run-start" : "")}
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
					<b>{chipFor(row)}</b>
					<span class="row-cap">{short(captionFor(row))}</span>
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
							<span class="traj-popover-chip">{chipFor(selectedRow()!)}</span>
							<span class="traj-popover-title">{short(captionFor(selectedRow()!))}</span>
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
									<pre class="traj-raw">{json(selectedRow()!.node.record.sliceMessage)}</pre>
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
