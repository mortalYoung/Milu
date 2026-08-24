/**
 * TrajectoryDrawer — the whole origin-log timeline (direction B, deepseek-harness reference).
 * Every log entry is one node: a column in the top band, a row in the bottom list.
 * Assistant records split into separate rows — thinking and each tool call get their own
 * row, and a toolResult merges into the tool row it answers (band positions unchanged).
 */
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { TrajectoryBlock, TrajectoryRecord, TrajectoryUsage } from "../../shared/rpc";
import { stringifyArgs, type TimelineNode, timelineNodes } from "../../shared/trajectory";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (ts: number) => {
	const d = new Date(ts);
	// non-today rows show the date too (the full datetime lives in the expanded body)
	const now = new Date();
	const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return sameDay ? time : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
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
					// a request boundary: the header, or the escalation that precedes a request
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
	| { kind: "stepLabel" }
);

/** One foldable run: its divider head (RUN label; seal-tinted on failure, error text on the head) and its content rows. */
interface RunSection {
	turn: number;
	reason: string;
	error: string;
	rows: DisplayRow[];
}

export function TrajectoryDrawer(props: { open: boolean; onOpenChange: (open: boolean) => void; records: TrajectoryRecord[] }) {
	const [expandedKey, setExpandedKey] = createSignal<string | null>(null);
	// Folded runs (by run number); everything is expanded by default
	const [foldedRuns, setFoldedRuns] = createSignal<Set<number>>(new Set());

	const summary = createMemo(() => timelineNodes(props.records));
	const nodes = () => summary().nodes;
	// Band shows every record; the list skips position-only marks (band markers + floating dots)
	const rows = () => nodes().filter((n) => !n.positionOnly);
	const turns = () => summary().turns;
	const turnOf = (n: TimelineNode) => turns().find((t) => t.turn === n.turn);

	/**
	 * Group the log into foldable run sections. turn/step are block concepts, not rows:
	 * - turn/start opens a section (or reopens it when its user question already did) and becomes
	 *   the run's divider head; turn/end attaches the end reason to that head and closes it
	 * - step/start becomes a corner label row at the top of its step's region; step/end renders nothing
	 * - a user question opens a section when none is open (the run that follows it), while a
	 *   mid-run follow-up stays inside its run
	 * - everything else becomes a content row (assistant split, tool results merged into their
	 *   tool row, harness-delivery SEND rows skipped — the MSG row already shows that text)
	 */
	const sections = createMemo<{ sections: RunSection[]; seqTurn: Map<number, number> }>(() => {
		const all: RunSection[] = [];
		const seqTurn = new Map<number, number>();
		let current: RunSection | null = null;
		let closed = true; // no open section: a user question or turn/start opens one
		let pendingCalls = new Map<string, number>(); // toolCallId → tool row index in current.rows
		const push = (row: DisplayRow) => {
			if (!current) {
				// the log's first record (e.g. system_prompt) opens run 1 and the section is open —
				// otherwise the next user question would split run 1 into two RUN 1 sections
				current = { turn: 1, reason: "", error: "", rows: [] };
				all.push(current);
				closed = false;
			}
			current.rows.push(row);
			seqTurn.set(row.node.seq, current.turn);
		};
		/** Push a row and return its index in the section (the section exists after the push). */
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
					// a corner label at the top of each step's region — no divider lines
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
				// step/end renders nothing
				continue;
			}
			if (r.kind === "user") {
				if (!current || closed) {
					// a user question opens the run that follows it — the run number comes from its turn/start
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
				// An assistant's parts display in a fixed order — thinking → tool calls → text —
				// regardless of the raw block order in the message. A text-less assistant drops
				// its head row entirely; request marks go to the first part row.
				let marksPending = n.requestMarks;
				const pushPart = (row: DisplayRow) => {
					pushIndex(row);
					marksPending = 0;
				};
				for (const b of r.blocks) {
					if (b.type !== "thinking") continue;
					// keys carry the row index — multiple parts of one assistant must not collide
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
			if (r.kind === "custom" && r.customType === "send_message" && (r.data as { toolCallId?: unknown } | null)?.toolCallId === "harness-delivery") {
				// harness-delivery: the backstop persisted the assistant's own final text — the MSG row
				// already shows it, so no separate SEND row (the fold keeps the record for the band and
				// turn hasMessage)
				continue;
			}
			if (r.kind === "custom" && r.customType === "tool/call") {
				// tool/call is the call-time durability record — the TOOL row (from the assistant's
				// toolCall block) already shows name/args/result, so no separate CUSTOM row
				continue;
			}
			push({ key: `r:${n.seq}`, node: n, marks: n.requestMarks, kind: "row" });
		}
		return { sections: all, seqTurn };
	});

	const allRows = createMemo(() => sections().sections.flatMap((s) => s.rows));
	const expandedNode = () => allRows().find((r) => r.key === expandedKey())?.node;

	const toggleRun = (turn: number) => {
		const next = new Set(foldedRuns());
		if (next.has(turn)) next.delete(turn);
		else next.add(turn);
		// collapsing a run hides its expanded row — drop the stale expansion
		if (next.has(turn) && expandedKey() != null) {
			const row = allRows().find((r) => r.key === expandedKey());
			if (row && sections().seqTurn.get(row.node.seq) === turn) setExpandedKey(null);
		}
		setFoldedRuns(next);
	};

	// Expand the first display row of a node (band click): merged toolResults expand their tool row;
	// a node inside a folded run unfolds the run first
	const expandNode = (n: TimelineNode) => {
		const row = allRows().find((r) => r.node.seq === n.seq);
		if (!row) return; // position-only marks have no list row
		const run = sections().seqTurn.get(n.seq);
		if (run != null && foldedRuns().has(run)) toggleRun(run);
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
		// turn/step markers are block concepts now — the run/step lines in the list carry them;
		// tool/call is the call-time record the TOOL row already shows (no band column either)
		if (
			n.record.kind === "custom" &&
			(n.record.customType === "turn/start" ||
				n.record.customType === "turn/end" ||
				n.record.customType === "step/start" ||
				n.record.customType === "step/end" ||
				n.record.customType === "tool/call")
		)
			return null;
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
			// JSON args flatten to one line for the caption; a non-JSON string shows its first line verbatim
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
			{row.result ? <pre class={"one-args" + (row.result.isError ? " err" : "")}>{row.result.text}</pre> : <span class="traj-interrupted">(interrupted)</span>}
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

	// ————— expanded body per record kind (single-row records) —————
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

						{/* Bottom: foldable run sections — a RUN divider line folds its run; every other
						    part is an expandable row (request dots float on rows). Signal reads stay
						    inline in JSX — For callbacks run untracked, a hoisted read never re-renders. */}
						<div class="traj-all" ref={listRef}>
							<For each={sections().sections}>
								{(sec) => (
									<div class="traj-run">
										<button
											class={"traj-run-head" + (sec.reason && sec.reason !== "completed" ? " err" : "")}
											onClick={() => toggleRun(sec.turn)}
											aria-expanded={!foldedRuns().has(sec.turn)}
										>
											<span class="run-label">{foldedRuns().has(sec.turn) ? "▸" : "▾"} RUN</span>
											{sec.error && (
												<span class="run-error" title={sec.error}>
													{short(sec.error)}
												</span>
											)}
										</button>
										<Show when={!foldedRuns().has(sec.turn)}>
											<div class="traj-run-body traj-run-enter">
												<For each={sec.rows}>
													{(row) =>
														row.kind === "stepLabel" ? (
															<div class="traj-step-label">STEP</div>
														) : (
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
														)
													}
												</For>
											</div>
										</Show>
									</div>
								)}
							</For>
						</div>
					</>
				)}

				<div class="traj-foot">the whole log · fold a run from its RUN line</div>
			</aside>
		</Show>
	);
}
