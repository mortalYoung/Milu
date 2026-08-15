/**
 * TrajectoryDrawer — whole-conversation view (direction B, deepseek-harness reference).
 * Every record is a node (system prompt / user / reminder / assistant / tool / message).
 * Top: a horizontally scrollable timeline band with per-node columns and turn boundaries.
 * Bottom: a list of all nodes grouped by turn ("Turn N" separators).
 * Clicking a node (cell or row) shows that node's detail; clicking again returns to the list.
 */
import { type Accessor, createEffect, createMemo, createSignal, For } from "solid-js";
import { AnimatePresence, Motion, MotionConfigProvider } from "solid-motion";
import type { TrajectoryRecord } from "../../shared/rpc";
import { type TrajectoryNode, trajectoryNodes } from "../../shared/trajectory";
import { renderMarkdown } from "../lib/markdown";

const pad = (n: number) => String(n).padStart(2, "0");
const fmtTime = (ts: number) => {
	const d = new Date(ts);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtTok = (n: number) => (n > 0 ? n.toLocaleString() : "—");

/** Cell height by tool count: 0-1 / 2 / 3+ → 38 / 55 / 72%. */
const toolHeight = (tools: { name: string; args: string }[]) => (tools.length >= 3 ? 72 : tools.length >= 2 ? 55 : 38);

export function TrajectoryDrawer(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	records: TrajectoryRecord[];
	/** Scroll the chat to a message by its pi id. */
	onLocate: (piId: string) => void;
	/** The reply currently visible in the chat (pi id); its turn's cell gets a subtle outline. */
	visibleReplyId: Accessor<string | null>;
	/** When opened from a message link, focus that node (pi id). */
	focusMessageId: Accessor<string | null>;
	onFocusConsumed: () => void;
}) {
	const [selectedSeq, setSelectedSeq] = createSignal<number | null>(null);

	const summary = createMemo(() => trajectoryNodes(props.records));
	const nodes = () => summary().nodes;
	const turns = () => summary().turns;
	const turnOf = (n: number) => turns().find((t) => t.turn === n);

	// Focus the node when the drawer opens via a message link
	createEffect(() => {
		if (!props.open) return;
		const focus = props.focusMessageId();
		if (!focus) return;
		const node = nodes().find((n) => (n.kind === "user" || n.kind === "message") && n.messageId === focus);
		if (node) setSelectedSeq(node.seq);
		props.onFocusConsumed();
	});

	const selectedNode = () => nodes().find((n) => n.seq === selectedSeq()) ?? null;
	const selectedIdx = () => nodes().findIndex((n) => n.seq === selectedSeq());
	const selectNode = (n: TrajectoryNode) => setSelectedSeq(selectedSeq() === n.seq ? null : n.seq);

	// Prev/next node navigation from the detail view
	const nav = (dir: 1 | -1) => {
		const next = nodes()[selectedIdx() + dir];
		if (next) setSelectedSeq(next.seq);
	};

	// ESC: back to the list when a node is selected, otherwise close the drawer
	createEffect(() => {
		if (!props.open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (selectedSeq() != null) setSelectedSeq(null);
			else props.onOpenChange(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const short = (s: string) => (s.length > 26 ? s.slice(0, 26) + "…" : s);

	// Band + labels share the same sequence, so boundaries and columns stay aligned
	const nodeColumn = (n: TrajectoryNode, i: number) => {
		const boundary = i > 0 && nodes()[i - 1].turn !== n.turn ? <span class="traj-boundary" /> : null;
		if (n.kind === "assistant") {
			const t = turnOf(n.turn);
			return (
				<>
					{boundary}
					<button
						class={"traj-cell " + (n.density ?? "l1") + (selectedSeq() === n.seq ? " hot" : "") + (t?.messageId === props.visibleReplyId() ? " live" : "")}
						style={{ height: toolHeight(t?.tools ?? []) + "%" }}
						title={`T${n.turn} · ${short(n.text ?? "")}`}
						onClick={() => selectNode(n)}
					/>
				</>
			);
		}
		return (
			<>
				{boundary}
				<span class={"traj-marker" + (selectedSeq() === n.seq ? " hot" : "")}>
					{n.kind === "user" ? (
						<button class="mq" title={short(n.text ?? "")} onClick={() => selectNode(n)} />
					) : n.kind === "system" ? (
						<button class="msys" title={short(n.text ?? "")} onClick={() => selectNode(n)} />
					) : n.kind === "reminder" ? (
						<button class="mrm" title={short(n.text ?? "")} onClick={() => selectNode(n)} />
					) : n.kind === "tool" ? (
						<button class="mtool" title={`${n.toolName} ${short(n.args ?? "")}`} onClick={() => selectNode(n)} />
					) : (
						<button class="mmsg" title={short(n.text ?? "")} onClick={() => selectNode(n)} />
					)}
				</span>
			</>
		);
	};

	const nodeRow = (n: TrajectoryNode) => {
		if (n.kind === "user") {
			return (
				<button class="traj-row q" onClick={() => selectNode(n)}>
					<b>Q</b>
					<span class="row-cap">{short(n.text ?? "")}</span>
				</button>
			);
		}
		if (n.kind === "system") {
			return (
				<button class="traj-row sys" onClick={() => selectNode(n)}>
					<b>SYS</b>
					<span class="row-cap">System prompt</span>
				</button>
			);
		}
		if (n.kind === "reminder") {
			return (
				<button class="traj-row rm" onClick={() => selectNode(n)}>
					<b>RM</b>
					<span class="row-cap">{short(n.text ?? "")}</span>
				</button>
			);
		}
		if (n.kind === "tool") {
			return (
				<button class="traj-row tool" onClick={() => selectNode(n)}>
					<b>{n.toolName}</b>
					<span class="row-cap mono">{short(n.args ?? "")}</span>
				</button>
			);
		}
		if (n.kind === "message") {
			return (
				<button class="traj-row msg" onClick={() => selectNode(n)}>
					<b>MSG</b>
					<span class="row-cap">{short(n.text ?? "")}</span>
				</button>
			);
		}
		return (
			<button class="traj-row" onClick={() => selectNode(n)}>
				<b>T{n.turn}</b>
				<span class="row-cap">{short(n.text ?? "")}</span>
				<span class="row-tok">{fmtTok(n.tokens ?? 0)}</span>
			</button>
		);
	};

	// ————— selected node detail —————
	const nodeHead = (n: TrajectoryNode) => {
		switch (n.kind) {
			case "system":
				return "System prompt";
			case "user":
				return `User · ${fmtTime(n.time)}`;
			case "reminder":
				return `Reminder · ${fmtTime(n.time)}`;
			case "assistant":
				return `Turn ${n.turn} · assistant · ${fmtTime(n.time)}`;
			case "tool":
				return `tool · ${n.toolName} · ${fmtTime(n.time)}`;
			case "message":
				return `Message · ${fmtTime(n.time)}`;
		}
	};
	const nodeMeta = (n: TrajectoryNode) => (n.kind === "assistant" ? `${fmtTok(n.tokens ?? 0)} tok` : "");
	const nodeBody = (n: TrajectoryNode) => {
		if (n.kind === "assistant") {
			// Text-less turns render their tool calls inline instead of an empty label
			const tools = turnOf(n.turn)?.tools ?? [];
			if (!n.text && !n.thinking && tools.length === 0) return null;
			return (
				<>
					{n.thinking && (
						<>
							<div class="one-think-label">thinking</div>
							<p class="one-thinking">{n.thinking}</p>
						</>
					)}
					{n.text ? (
						<div class="md one-cap" innerHTML={renderMarkdown(n.text)} />
					) : tools.length > 0 ? (
						<div class="one-tools">
							<For each={tools}>
								{(t) => (
									<div class="one-tool">
										<span class="one-tool-name">{t.name}</span>
										<pre class="one-args">{t.args}</pre>
									</div>
								)}
							</For>
						</div>
					) : null}
				</>
			);
		}
		if (n.kind === "tool") {
			return (
				<div class="one-tools">
					{n.args && <pre class="one-args">{n.args}</pre>}
					{n.result && <pre class={"one-args" + (n.result.isError ? " err" : "")}>{n.result.text}</pre>}
				</div>
			);
		}
		if (n.kind === "system" || n.kind === "message") {
			return <div class="md one-cap" innerHTML={renderMarkdown(n.text ?? "")} />;
		}
		return <div class="one-cap plain">{n.text}</div>;
	};

	return (
		<MotionConfigProvider reducedMotion="user">
			<AnimatePresence>
				{props.open && (
					<Motion
						as="aside"
						class="traj-drawer"
						initial={{ x: 24, opacity: 0 }}
						animate={{ x: 0, opacity: 1 }}
						exit={{ x: 24, opacity: 0 }}
						transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
					>
						<div class="traj-head">
							<span class="traj-title">Trajectory</span>
							<span class="traj-count">
								{nodes().length} nodes · {turns().length} turns
							</span>
							<button class="traj-close" title="Close" onClick={() => props.onOpenChange(false)}>
								×
							</button>
						</div>

						{/* Top band: every node is a column; vertical boundaries mark turn changes */}
						<div class="traj-scroll">
							<div class="traj-band">
								<For each={nodes()}>{(n, i) => nodeColumn(n, i())}</For>
							</div>
						</div>

						{/* Bottom: all nodes grouped by turn, or the selected node's detail */}
						<div class="traj-detail">
							{selectedNode() == null ? (
								<div class="traj-all">
									<For each={nodes()}>
										{(n, i) => (
											<>
												{i() === 0 || nodes()[i() - 1].turn !== n.turn ? <div class="traj-turn-sep">Turn {n.turn}</div> : null}
												{nodeRow(n)}
											</>
										)}
									</For>
								</div>
							) : (
								<div class="traj-one">
									<div class="one-head">
										<span>{nodeHead(selectedNode()!)}</span>
										<span>{nodeMeta(selectedNode()!)}</span>
									</div>
									{nodeBody(selectedNode()!)}
									{(selectedNode()!.kind === "user" || selectedNode()!.kind === "message") && selectedNode()!.messageId && (
										<button class="one-locate" onClick={() => selectedNode()!.messageId && props.onLocate(selectedNode()!.messageId!)}>
											locate in chat
										</button>
									)}
									<div class="traj-nav">
										<button onClick={() => nav(-1)} disabled={selectedIdx() <= 0}>
											← prev
										</button>
										<button class="back" onClick={() => setSelectedSeq(null)}>
											back to list
										</button>
										<button onClick={() => nav(1)} disabled={selectedIdx() >= nodes().length - 1}>
											next →
										</button>
									</div>
								</div>
							)}
						</div>

						<div class="traj-foot">click a cell or row to view its detail · click again to return</div>
					</Motion>
				)}
			</AnimatePresence>
		</MotionConfigProvider>
	);
}
