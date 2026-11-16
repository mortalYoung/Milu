import { LOG_EVENTS } from "@milu/protocol";
import type { Host, StepGroup, ViewItem } from "@milu/window/api";
import { AgentMessage, UserMessage } from "@milu/window/api/messages";
import { ChevronDown } from "lucide-react";
import { createElement, useEffect, useState } from "react";

import { trajectoryNode } from "../../trajectory/meta.ts";
import type { TrajectoryBlock, TrajectoryDetail, TrajectoryRecord, TrajectoryTone } from "../../trajectory/model.ts";
import { CAPTION_TONE, CHIP_TONE, Detail } from "../../trajectory/parts.tsx";
import { clockOf, secondsOf, whenOf } from "../format.ts";
import type { MemorySnapshot } from "../snapshot.ts";
import type { MemoryTrace } from "../store.ts";

const POLL_MS = 1200;
const EYEBROW = "m-0 px-2 pt-1 pb-1.5 text-[9.5px] font-semibold tracking-[0.12em] text-muted uppercase";
const ROW = "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover";

type View = "transcript" | "trajectory";

interface Turn {
	readonly kind: "system" | "user" | "assistant";
	readonly id: string;
	readonly text: string;
	readonly time: number;
	readonly rows: ViewItem[];
}

function firstLine(text: string): string {
	return (
		text
			.split("\n")
			.find((line) => line.trim() !== "")
			?.trim() ?? ""
	);
}

function SystemPrompt(props: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="step-ribbon" data-open={open}>
			<button type="button" className="step-head" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className="step-chev">
					<ChevronDown size={13} aria-hidden="true" />
				</span>
				<span className="step-stamp">system prompt</span>
				<span className="step-duration">{props.text.length} chars</span>
				<span className="step-latest">
					<span className="step-latest-detail">{firstLine(props.text)}</span>
				</span>
			</button>
			<div className="step-body">
				<div className="step-body-inner">
					<pre className="m-0 max-h-[240px] overflow-y-auto rounded-[4px] border-[0.5px] border-line bg-surface px-2.5 py-2 font-mono text-[10px] leading-[1.6] whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
						{props.text}
					</pre>
				</div>
			</div>
		</div>
	);
}

function blocksText(blocks: readonly TrajectoryBlock[]): string {
	return blocks
		.filter((block) => block.type === "text")
		.map((block) => String(block.text ?? ""))
		.filter((text) => text !== "")
		.join("\n");
}

function turnsOf(records: readonly TrajectoryRecord[], live: boolean): Turn[] {
	const results = new Map<string, { content: string; isError: boolean }>();
	for (const record of records) if (record.kind === "toolResult") results.set(record.toolCallId, { content: record.content, isError: record.isError === true });

	const turns: Turn[] = [];
	for (const record of records) {
		if (record.kind === "user") {
			turns.push({ kind: "user", id: record.entryId, text: record.content, time: record.time, rows: [] });
			continue;
		}
		if (record.kind === "assistant") {
			const turn: Turn = { kind: "assistant", id: record.entryId, text: blocksText(record.blocks), time: record.time, rows: [] };
			record.blocks.forEach((block, index) => {
				if (block.type !== "thinking") return;
				turn.rows.push({
					id: `${record.entryId}-think-${index}`,
					kind: "assistant",
					text: "",
					time: record.time,
					thinking: { text: String(block.thinking ?? "") },
				});
			});
			turns.push(turn);
			continue;
		}
		if (record.kind !== "custom") continue;
		if (record.metaKey === LOG_EVENTS.systemPrompt) {
			const data = (record.data ?? {}) as { text?: unknown };
			turns.push({ kind: "system", id: record.entryId, text: String(data.text ?? ""), time: record.time, rows: [] });
			continue;
		}
		if (record.metaKey !== LOG_EVENTS.toolCall) continue;
		const data = (record.data ?? {}) as { name?: unknown; args?: unknown; callId?: unknown };
		const callId = String(data.callId ?? "");
		const last = turns[turns.length - 1];
		if (last?.kind !== "assistant") continue;
		const result = results.get(callId);
		last.rows.push({
			id: `${record.entryId}-tool`,
			kind: "assistant",
			text: "",
			time: record.time,
			tool: {
				callId,
				name: String(data.name ?? "tool"),
				summary: "",
				status: result === undefined ? (live ? "running" : "pending") : result.isError ? "error" : "success",
				args: JSON.stringify(data.args ?? {}),
				result: result?.content ?? "",
			},
		});
	}
	return turns;
}

type Block = { readonly kind: "message"; readonly turn: Turn } | { readonly kind: "steps"; readonly key: string; readonly rows: ViewItem[] };

function blocksOf(turns: readonly Turn[]): Block[] {
	const blocks: Block[] = [];
	for (const turn of turns) {
		if (turn.kind !== "assistant") {
			if (turn.kind !== "system" || turn.text.trim() !== "") blocks.push({ kind: "message", turn });
			continue;
		}
		if (turn.text.trim() !== "") blocks.push({ kind: "message", turn });
		if (turn.rows.length === 0) continue;
		const last = blocks[blocks.length - 1];
		if (last?.kind === "steps") last.rows.push(...turn.rows);
		else blocks.push({ kind: "steps", key: turn.id, rows: [...turn.rows] });
	}
	return blocks;
}

function Transcript(props: { records: readonly TrajectoryRecord[]; host: Host; live: boolean }) {
	const blocks = blocksOf(turnsOf(props.records, props.live));
	const running = blocks.reduce((at, block, index) => (block.kind === "steps" ? index : at), -1);
	const Step = props.host.rows.get("step");
	return (
		<>
			{blocks.map((block, index) => {
				if (block.kind === "steps") {
					const group: StepGroup = { key: block.key, rows: block.rows };
					return Step === undefined ? null : (
						<div key={block.key}>{createElement(Step, { host: props.host, data: { group, live: props.live && index === running && index === blocks.length - 1 } })}</div>
					);
				}
				const turn = block.turn;
				if (turn.kind === "system") return <SystemPrompt key={turn.id} text={turn.text} />;
				if (turn.kind === "user") return <UserMessage key={turn.id} host={props.host} item={{ id: turn.id, kind: "user", text: turn.text, time: turn.time }} />;
				return <AgentMessage key={turn.id} host={props.host} item={{ id: turn.id, kind: "assistant", text: turn.text, time: turn.time }} />;
			})}
		</>
	);
}

function Part(props: { chip: string; tone: TrajectoryTone; caption: string; details: readonly TrajectoryDetail[] }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="border-t-[0.5px] border-line-soft">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex w-full cursor-pointer items-center gap-2 bg-transparent px-1.5 py-[5px] text-left hover:bg-hover"
			>
				<b className={`min-w-[38px] flex-none text-left font-mono text-[10px] font-medium ${CHIP_TONE[props.tone] ?? "text-muted"}`}>{props.chip}</b>
				<span className={`min-w-0 flex-1 truncate font-serif text-[12px] ${CAPTION_TONE[props.tone] ?? "text-ink"}`}>{props.caption}</span>
			</button>
			{open ? (
				<div className="px-1.5 pb-2.5 pl-[46px]">
					{props.details.length === 0 ? <p className="m-0 font-mono text-[10px] text-muted-soft">no payload</p> : null}
					{props.details.map((detail, index) => (
						<Detail key={`${props.chip}-${index}`} detail={detail} />
					))}
				</div>
			) : null}
		</div>
	);
}

function speaks(record: TrajectoryRecord): boolean {
	if (record.kind === "custom" && record.metaKey === LOG_EVENTS.systemPrompt) {
		return String(((record.data ?? {}) as { text?: unknown }).text ?? "").trim() !== "";
	}
	if (record.kind !== "assistant") return true;
	return blocksText(record.blocks).trim() !== "" || record.blocks.some((block) => block.type === "thinking");
}

function Trajectory(props: { records: readonly TrajectoryRecord[] }) {
	const shown = props.records.filter(speaks);
	const turns = [...new Set(shown.map((record) => record.turn))].sort((left, right) => left - right);
	return (
		<>
			{turns.map((turn) => (
				<section key={turn}>
					<div className="mt-2 flex h-[20px] items-center gap-1.5 font-mono text-[9.5px] text-muted">
						<span>turn {turn}</span>
					</div>
					{shown
						.filter((record) => record.turn === turn)
						.map((record) => {
							const node = trajectoryNode(record);
							const parts = node.rows ?? [{ chip: node.chip, tone: node.tone, caption: node.caption, details: node.details }];
							return (
								<div key={record.entryId} className="flex flex-col">
									{parts.map((part, index) => (
										<Part key={index} chip={part.chip ?? "MSG"} tone={part.tone ?? node.tone ?? "plain"} caption={part.caption ?? ""} details={part.details ?? []} />
									))}
								</div>
							);
						})}
				</section>
			))}
		</>
	);
}

export function RunsPane(props: { host: Host; snapshot: MemorySnapshot; loadTrace: (runId: string) => Promise<MemoryTrace | null> }) {
	const [picked, setPicked] = useState<string | null>(null);
	const [loaded, setLoaded] = useState<{ readonly runId: string; readonly trace: MemoryTrace | null } | null>(null);
	const [view, setView] = useState<View>("transcript");
	const { loadTrace } = props;

	const live = props.snapshot.running;
	const finished = [...props.snapshot.runs].reverse();
	const active = picked ?? live[0]?.runId ?? finished[0]?.runId ?? null;
	const liveEntry = live.find((entry) => entry.runId === active) ?? null;
	const settled = loaded !== null && loaded.runId === active;
	const shown = settled ? loaded.trace : null;
	const records = shown?.records ?? [];

	useEffect(() => {
		if (active === null) return;
		let cancelled = false;
		void loadTrace(active).then((next) => {
			if (!cancelled) setLoaded({ runId: active, trace: next });
		});
		return () => {
			cancelled = true;
		};
	}, [active, loadTrace]);

	useEffect(() => {
		if (liveEntry === null) return;
		const timer = window.setInterval(() => {
			void loadTrace(liveEntry.runId).then((next) => {
				if (next !== null) setLoaded({ runId: liveEntry.runId, trace: next });
			});
		}, POLL_MS);
		return () => window.clearInterval(timer);
	}, [liveEntry, loadTrace]);

	return (
		<div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)]">
			<div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r-[0.5px] border-line px-2 pt-2 pb-3 [scrollbar-gutter:stable]">
				<p className={EYEBROW}>
					Runs · {finished.length} of {props.snapshot.runsTotal}
				</p>
				{live.map((entry) => (
					<button
						type="button"
						key={entry.runId}
						aria-current={entry.runId === active ? "true" : undefined}
						onClick={() => setPicked(entry.runId)}
						className={`${ROW} cursor-pointer${entry.runId === active ? " bg-selected" : ""}`}
					>
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent-teal" />
							<span className="min-w-0 flex-1 truncate font-serif text-[14px] font-semibold leading-[1.2] tracking-[-0.005em] text-ink uppercase">{entry.stage}</span>
							<span className="shrink-0 font-mono text-[9.5px] tabular-nums text-muted-soft">{clockOf(entry.startedAt)}</span>
						</span>
						<span className="flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] leading-[1.3] text-muted">
							<span className="text-accent-teal">running</span>
						</span>
					</button>
				))}
				{finished.map((run) => {
					const bad = run.reason === "error" || run.reason === "interrupted";
					const warn = run.reason === "blocked" || run.reason === "unfinished";
					return (
						<button
							type="button"
							key={run.runId}
							title={run.error}
							aria-current={run.runId === active ? "true" : undefined}
							onClick={() => setPicked(run.runId)}
							className={`${ROW} cursor-pointer${run.runId === active ? " bg-selected" : ""}`}
						>
							<span className="flex min-w-0 items-center gap-1.5">
								<span className="min-w-0 flex-1 truncate font-serif text-[14px] font-semibold leading-[1.2] tracking-[-0.005em] text-ink uppercase">{run.stage}</span>
								<span className="shrink-0 font-mono text-[9.5px] tabular-nums text-muted-soft">{whenOf(run.startedAt)}</span>
							</span>
							<span className="flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] leading-[1.3] text-muted">
								<span className={`truncate ${bad ? "text-signal" : warn ? "text-accent-amber" : ""}`}>{run.reason}</span>
								<span className="shrink-0 text-muted-soft">·</span>
								<span className="shrink-0 tabular-nums">{secondsOf(run.durationMs)}</span>
							</span>
						</button>
					);
				})}
				{live.length === 0 && finished.length === 0 ? <p className="m-0 px-2 py-1 text-[13px] text-muted">no runs yet</p> : null}
			</div>

			<div className="flex min-h-0 flex-col">
				<div className="flex h-8 shrink-0 items-center gap-2 border-b-[0.5px] border-line px-4">
					<p className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[9.5px] tabular-nums text-muted-soft">
						{shown === null ? (
							<span>{active === null ? "no run selected" : "reading transcript…"}</span>
						) : (
							<>
								<span className="text-ink-soft uppercase">{shown.stage}</span>
								<span>{clockOf(shown.startedAt)}</span>
								<span>·</span>
								<span>{secondsOf(shown.endedAt - shown.startedAt)}</span>
								<span>·</span>
								<span>{shown.reason}</span>
								<span>·</span>
								<span className="truncate">{shown.model}</span>
								{liveEntry === null ? null : <span className="text-accent-teal">· live</span>}
							</>
						)}
					</p>
					<span className="flex-1" />
					<div className="flex flex-none items-center gap-0.5 rounded-[4px] border-[0.5px] border-line p-[1px]" role="group" aria-label="Run view">
						{(["transcript", "trajectory"] as const).map((each) => (
							<button
								type="button"
								key={each}
								aria-pressed={view === each}
								onClick={() => setView(each)}
								className={`cursor-pointer rounded-[4px] px-1.5 py-[1px] font-mono text-[9.5px] tracking-[0.12em] uppercase transition-colors ${
									view === each ? "bg-ink text-canvas" : "bg-transparent text-muted hover:text-ink"
								}`}
							>
								{each}
							</button>
						))}
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-5 [scrollbar-gutter:stable]">
					{shown === null ? (
						<p className="m-0 mt-3 font-mono text-[10px] text-muted">
							{active === null ? "select a run" : liveEntry === null ? "no transcript kept for this run" : "waiting for the first turn…"}
						</p>
					) : view === "transcript" ? (
						<Transcript records={records} host={props.host} live={liveEntry !== null} />
					) : (
						<Trajectory records={records} />
					)}
				</div>
			</div>
		</div>
	);
}
