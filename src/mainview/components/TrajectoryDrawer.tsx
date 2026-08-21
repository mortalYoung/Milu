/**
 * TrajectoryDrawer — the whole origin-log timeline (direction B, deepseek-harness reference).
 * Every log entry is one node: a column in the top band, a row in the bottom list.
 * Assistant records split into separate rows — thinking and each tool call get their own
 * row, and a toolResult merges into the tool row it answers (band positions unchanged).
 */
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { TrajectoryBlock, TrajectoryRecord, TrajectoryUsage } from "../../shared/rpc";
import { stringifyArgs, type TimelineNode, timelineNodes } from "../../shared/trajectory";
import { renderMarkdown } from "../lib/markdown";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (ts: number) => {
	const d = new Date(ts);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDateTime = (ts: number) => {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const fmtTok = (n: number | undefined) => (n && n > 0 ? n.toLocaleString() : "—");
const short = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);
const firstLine = (s: string) => s.split("\n").find((l) => l.trim()) ?? "";

/** Cell height by tool count: 0-1 / 2 / 3+ → 38 / 55 / 72%. */
const toolHeight = (tools: { name: string; args: string }[]) => (tools.length >= 3 ? 72 : tools.length >= 2 ? 55 : 38);

/** Pretty-print an unknown value (raw custom data / tool details). */
const json = (v: unknown): string => {
	try {
		return JSON.stringify(v, null, 2);
	} catch {
		return String(v);
	}
};

/** Text carried by a custom entry's data. */
const dataText = (data: unknown): string => {
	const d = data as { text?: unknown } | null;
	return typeof d?.text === "string" ? d.text : "";
};

/** Text blocks of an assistant record, in order (thinking/toolCall/image never count as text). */
const textBlocks = (blocks: TrajectoryBlock[]): string[] => blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? ""));

const fmtUsage = (u: TrajectoryUsage | undefined) =>
	u
		? `in ${fmtTok(u.input)} · out ${fmtTok(u.output)} · cacheRead ${fmtTok(u.cacheRead)} · cacheWrite ${fmtTok(u.cacheWrite)}${u.reasoning ? ` · reasoning ${fmtTok(u.reasoning)}` : ""} tok`
		: "";

/** Band marker class per record kind (assistant uses a density cell instead). */
function markerClass(record: TrajectoryRecord): string | null {
	switch (record.kind) {
		case "assistant":
			return null;
		case "user":
			return "mq";
		case "toolResult":
			return "mres";
		case "modelChange":
		case "thinkingLevel":
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

/** Short row label (single-row records and split parts; band titles use rowCaption). */
function chipLabel(record: TrajectoryRecord): string {
	switch (record.kind) {
		case "user":
			return "Q";
		case "assistant":
			return "MSG";
		case "toolResult":
			return "RES";
		case "modelChange":
			return "MOD";
		case "thinkingLevel":
			return "LVL";
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

/** One-line caption for the row header (the detail body holds the full data). */
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
		case "thinkingLevel":
			return record.thinkingLevel;
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
					const h = record.data as { toolNames?: unknown } | null;
					const names = Array.isArray(h?.toolNames) ? h.toolNames.map((n) => String(n)) : [];
					return names.length > 0 ? names.join(", ") : "request header";
				}
				default:
					return record.customType;
			}
	}
}

/**
 * Row tint class per record family — the base row style is shared by all kinds;
 * only families with a CSS override emit a class (see the traj-row tint rules).
 */
function rowClass(record: TrajectoryRecord): string {
	switch (record.kind) {
		case "modelChange":
		case "thinkingLevel":
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

/** One list row after assistant splitting: a record rendered as-is, or a part of an assistant. */
type DisplayRow = { key: string; node: TimelineNode; marks?: number } & (
	| { kind: "row" }
	| { kind: "assistant"; textBlocks: TrajectoryBlock[]; otherBlocks: TrajectoryBlock[] }
	| { kind: "thinking"; block: TrajectoryBlock }
	| { kind: "tool"; block: TrajectoryBlock; callId: string; result?: { text: string; isError: boolean } }
);

export function TrajectoryDrawer(props: { open: boolean; onOpenChange: (open: boolean) => void; records: TrajectoryRecord[] }) {
	const [expandedKey, setExpandedKey] = createSignal<string | null>(null);

	const summary = createMemo(() => timelineNodes(props.records));
	const nodes = () => summary().nodes;
	// Band shows every record; the list skips position-only marks (band markers + floating dots)
	const rows = () => nodes().filter((n) => !n.positionOnly);
	const turns = () => summary().turns;
	const turnOf = (n: TimelineNode) => turns().find((t) => t.turn === n.turn);

	/**
	 * Expand the list into display rows: an assistant record splits into its head row plus a
	 * thinking row per thinking block and a tool row per tool call; a toolResult that answers
	 * one of those calls merges into its tool row (unmatched ones stay as standalone rows).
	 */
	const displayRows = createMemo<DisplayRow[]>(() => {
		const out: DisplayRow[] = [];
		let pendingCalls = new Map<string, number>(); // toolCallId → tool row index in out
		for (const n of rows()) {
			const r = n.record;
			if (r.kind === "assistant") {
				const headKey = `a:${n.seq}`;
				const textBlocksArr = r.blocks.filter((b) => b.type === "text");
				// An assistant's parts display in a fixed order — thinking → tool calls → text —
				// regardless of the raw block order in the message. A text-less assistant drops
				// its head row entirely; request marks go to the first part row.
				let marksPending = n.requestMarks;
				const pushPart = (row: DisplayRow) => {
					out.push(row);
					marksPending = 0;
				};
				for (const b of r.blocks) {
					if (b.type === "thinking") pushPart({ key: `${headKey}:think:${out.length}`, node: n, marks: marksPending || undefined, kind: "thinking", block: b });
				}
				pendingCalls = new Map();
				for (const b of r.blocks) {
					if (b.type !== "toolCall") continue;
					pushPart({ key: `${headKey}:tool:${out.length}`, node: n, marks: marksPending || undefined, kind: "tool", block: b, callId: String(b.id ?? "") });
					if (typeof b.id === "string") pendingCalls.set(b.id, out.length - 1);
				}
				if (textBlocksArr.length > 0) {
					out.push({
						key: headKey,
						node: n,
						marks: marksPending || undefined,
						kind: "assistant",
						textBlocks: textBlocksArr,
						otherBlocks: r.blocks.filter((b) => b.type !== "text" && b.type !== "toolCall" && b.type !== "thinking"),
					});
				}
			} else if (r.kind === "toolResult") {
				const target = pendingCalls.get(r.toolCallId);
				if (target != null && out[target].kind === "tool") {
					out[target] = { ...out[target], result: { text: r.content, isError: r.isError }, marks: (out[target].marks ?? 0) + (n.requestMarks ?? 0) };
				} else {
					out.push({ key: `r:${n.seq}`, node: n, marks: n.requestMarks, kind: "row" });
				}
			} else {
				out.push({ key: `r:${n.seq}`, node: n, marks: n.requestMarks, kind: "row" });
			}
		}
		return out;
	});

	const expandedNode = () => displayRows().find((r) => r.key === expandedKey())?.node;

	// Expand the first display row of a node (band click): merged toolResults expand their tool row
	const expandNode = (n: TimelineNode) => {
		const row = displayRows().find((r) => r.node.seq === n.seq);
		if (!row) return; // position-only marks have no list row
		setExpandedKey(expandedKey() === row.key ? null : row.key);
	};

	// The timeline band scrolls so the expanded node's column is centered
	let bandRef: HTMLDivElement | undefined;
	createEffect(() => {
		const node = expandedNode();
		if (!node || !bandRef) return;
		const el = bandRef.querySelector<HTMLElement>(`[data-seq="${node.seq}"]`);
		if (!el) return;
		const containerRect = bandRef.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		const target = bandRef.scrollLeft + (elRect.left - containerRect.left) - (containerRect.width - elRect.width) / 2;
		bandRef.scrollTo({ left: target, behavior: "smooth" });
	});

	// Newest content in view: the list scrolls to the bottom and the band to the right
	// whenever the drawer opens or the records change (the drawer fetches fresh data per open).
	let listRef: HTMLDivElement | undefined;
	createEffect(() => {
		props.open;
		nodes();
		if (listRef) listRef.scrollTop = listRef.scrollHeight;
		if (bandRef) bandRef.scrollLeft = bandRef.scrollWidth;
	});

	// ESC: collapse the expanded row when one is open, otherwise close the drawer
	createEffect(() => {
		if (!props.open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (expandedKey() != null) setExpandedKey(null);
			else props.onOpenChange(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// ————— band —————
	// For item callbacks run in an untracked context — every signal read must sit in a JSX
	// expression (compiled to tracked template computations), never hoisted to a local
	const nodeColumn = (n: TimelineNode, i: number) => {
		const boundary = i > 0 && nodes()[i - 1].turn !== n.turn ? <span class="traj-boundary" /> : null;
		if (n.record.kind === "assistant") {
			const t = turnOf(n);
			return (
				<>
					{boundary}
					<button
						class={"traj-cell " + (t?.density ?? "l1") + (expandedNode()?.seq === n.seq ? " hot" : "")}
						style={{ height: toolHeight(t?.tools ?? []) + "%" }}
						data-seq={n.seq}
						title={`T${n.record.turn} · ${short(rowCaption(n.record))}`}
						onClick={() => expandNode(n)}
					/>
				</>
			);
		}
		const marker = markerClass(n.record);
		return (
			<>
				{boundary}
				<span class={"traj-marker" + (expandedNode()?.seq === n.seq ? " hot" : "")} data-seq={n.seq}>
					<button class={marker ?? "mcustom"} title={short(rowCaption(n.record))} onClick={() => expandNode(n)} />
				</span>
			</>
		);
	};

	// ————— row parts —————
	const rowClassFor = (row: DisplayRow) => {
		if (row.kind === "thinking") return "think";
		if (row.kind === "tool") return "tool";
		return rowClass(row.node.record); // assistant and plain rows carry no tint class
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
			const args = firstLine(stringifyArgs(row.block.arguments));
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
			{row.result ? <pre class={"one-args" + (row.result.isError ? " err" : "")}>{row.result.text}</pre> : <span class="traj-interrupted">(interrupted)</span>}
		</div>
	);

	const assistantBody = (row: Extract<DisplayRow, { kind: "assistant" }>) => {
		const r = row.node.record;
		if (r.kind !== "assistant") return null;
		return (
			<>
				<For each={row.textBlocks}>{(b) => <div class="md one-cap" innerHTML={renderMarkdown(String(b.text ?? ""))} />}</For>
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

	// ————— expanded body per record kind (single-row records) —————
	const nodeBody = (n: TimelineNode) => {
		const r = n.record;
		switch (r.kind) {
			case "user":
				return <div class="md one-cap" innerHTML={renderMarkdown(r.content)} />;
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
			case "thinkingLevel":
				return (
					<div class="traj-meta">
						<span>{r.thinkingLevel}</span>
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
						return <div class="md one-cap" innerHTML={renderMarkdown(dataText(r.data))} />;
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
						// The full system prompt lives in the system_prompt row — this body shows the tools only
						const d = (r.data ?? {}) as { toolNames?: unknown };
						const names = Array.isArray(d.toolNames) ? d.toolNames : [];
						return (
							<div class="one-tools">
								<For each={names}>{(name) => <span class="one-tool-name">{String(name)}</span>}</For>
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

	// No solid-motion wrapper and no body-level `props.open && ...`: AnimatePresence
	// instantiates children inside untrack() (freezing the whole tree), and a component
	// body runs once in an untracked context too (a body-level conditional is static).
	// <Show> is a tracked conditional; the CSS enter animation replaces the motion shell.
	return (
		<Show when={props.open}>
			<aside class="traj-drawer traj-enter">
				<div class="traj-head">
					<span class="traj-title">Trajectory</span>
					<span class="traj-count">
						{nodes().length} entries · {turns().length} turns
					</span>
					<button class="traj-close" title="Close" onClick={() => props.onOpenChange(false)}>
						×
					</button>
				</div>

				{nodes().length === 0 ? (
					<div class="traj-empty">no log entries yet — run a conversation first</div>
				) : (
					<>
						{/* Top band: every entry is a column; vertical boundaries mark turn changes */}
						<div class="traj-scroll" ref={bandRef}>
							<div class="traj-band">
								<For each={nodes()}>{(n, i) => nodeColumn(n, i())}</For>
							</div>
						</div>

						{/* Bottom: one expandable row per display part; request dots float on the divider */}
						<div class="traj-all" ref={listRef}>
							<For each={displayRows()}>
								{(row) => (
									<div class={"traj-row " + rowClassFor(row) + (expandedKey() === row.key ? " open" : "")}>
										{row.marks ? <span class="req-dot" /> : null}
										<button class="traj-row-head" onClick={() => setExpandedKey(expandedKey() === row.key ? null : row.key)} aria-expanded={expandedKey() === row.key}>
											<b>{chipFor(row)}</b>
											<span class="row-cap">{short(captionFor(row))}</span>
											<span class="row-time">{fmtTime(row.node.record.time)}</span>
										</button>
										{expandedKey() === row.key && (
											<div class="traj-body">
												{rowBody(row)}
												{(row.kind === "row" || row.kind === "assistant") && bodyMeta(row.node)}
											</div>
										)}
									</div>
								)}
							</For>
						</div>
					</>
				)}

				<div class="traj-foot">the whole log · click a row to expand</div>
			</aside>
		</Show>
	);
}
