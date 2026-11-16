import { useScrollEdges } from "@milu/window/api/scroll-edges";
import { useState } from "react";

import { agoOf, bytesOf, secondsOf } from "../format.ts";
import type { MemorySnapshot, MemorySnapshotFile } from "../snapshot.ts";
import type { MemoryRunStage, MemoryRunSummary } from "../store.ts";

const STAGE_ORDER: readonly MemoryRunStage[] = ["memory", "sop", "persona"];

const LABEL = "text-[9px] font-semibold tracking-[0.14em] text-muted uppercase";
const NOTE = "font-mono text-[9.5px] tabular-nums text-muted-soft";
const FILL = "bg-[color-mix(in_srgb,var(--ink)_3.5%,transparent)]";
const TRACK = "bg-[color-mix(in_srgb,var(--ink)_9%,transparent)]";

function toneOf(reason: MemoryRunSummary["reason"]): string {
	if (reason === "completed") return "text-muted";
	if (reason === "blocked" || reason === "unfinished") return "text-accent-amber";
	return "text-signal";
}

function Stat(props: { label: string; value: string; hint: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-[3px]">
			<span className={LABEL}>{props.label}</span>
			<span className="truncate font-mono text-[21px] leading-none font-medium tabular-nums text-ink">{props.value}</span>
			<span className={`${NOTE} truncate`}>{props.hint}</span>
		</div>
	);
}

function Share(props: { value: number; total: number; failed: number }) {
	const percent = props.total === 0 ? 0 : (props.value / props.total) * 100;
	return (
		<span className={`relative h-[3px] w-16 shrink-0 overflow-hidden rounded-full ${props.failed > 0 ? "bg-[color-mix(in_srgb,var(--accent-amber)_38%,transparent)]" : TRACK}`}>
			<span className="absolute inset-y-0 left-0 rounded-full bg-ink/45" style={{ width: `${percent}%` }} />
		</span>
	);
}

interface StageRow {
	readonly stage: MemoryRunStage;
	readonly runs: number;
	readonly ok: number;
	readonly atoms: number;
	readonly avgMs: number;
	readonly last: MemoryRunSummary;
}

function stageRows(runs: readonly MemoryRunSummary[]): readonly StageRow[] {
	const byStage = new Map<MemoryRunStage, MemoryRunSummary[]>();
	for (const run of runs) {
		const list = byStage.get(run.stage);
		if (list) list.push(run);
		else byStage.set(run.stage, [run]);
	}
	return STAGE_ORDER.filter((stage) => byStage.has(stage)).map((stage) => {
		const list = byStage.get(stage)!;
		const ok = list.filter((run) => run.reason === "completed").length;
		const atoms = list.reduce((sum, run) => sum + run.added, 0);
		const avgMs = list.reduce((sum, run) => sum + run.durationMs, 0) / list.length;
		return { stage, runs: list.length, ok, atoms, avgMs, last: list[list.length - 1]! };
	});
}

function Files(props: { files: readonly MemorySnapshotFile[]; total: number }) {
	return (
		<div className="flex flex-col pt-1">
			{[...props.files]
				.sort((left, right) => right.bytes - left.bytes)
				.map((file) => {
					const percent = props.total === 0 ? 0 : Math.round((file.bytes / props.total) * 100);
					return (
						<div key={file.label} className="grid grid-cols-[minmax(0,1fr)_56px_38px] items-baseline gap-2 py-[2px] font-mono text-[9.5px] tabular-nums">
							<span className="truncate text-muted">{file.label}</span>
							<span className="text-right text-ink-soft">{bytesOf(file.bytes)}</span>
							<span className="text-right text-muted-soft">{percent < 1 ? "<1%" : `${percent}%`}</span>
						</div>
					);
				})}
		</div>
	);
}

export function ActivityPane(props: { snapshot: MemorySnapshot }) {
	const [scrollRef, scrollClass] = useScrollEdges<HTMLDivElement>();
	const [openFiles, setOpenFiles] = useState(false);

	const snapshot = props.snapshot;
	const running = snapshot.running[0] ?? null;
	const stages = stageRows(snapshot.runs);
	const limits = snapshot.limits;
	const storage = snapshot.storage;
	const traces = storage.trace.reduce((sum, file) => sum + file.bytes, 0);
	const results = storage.results.reduce((sum, file) => sum + file.bytes, 0);
	const files = [...storage.results, ...storage.trace];
	const total = Math.max(1, storage.total);

	return (
		<div ref={scrollRef} className={`${scrollClass} flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-3 pb-5 [scrollbar-gutter:stable]`}>
			<div className="grid grid-cols-4 gap-5">
				<Stat
					label="state"
					value={running ? running.stage : snapshot.enabled === false ? "off" : snapshot.pending.pending ? "queued" : "idle"}
					hint={running ? "running now" : snapshot.enabled === false ? "memory disabled" : snapshot.pending.pending ? "work waiting" : "nothing queued"}
				/>
				<Stat label="queued" value={String(snapshot.pending.rounds)} hint={limits.pendingRounds > 0 ? `of ${limits.pendingRounds} rounds` : "organize off"} />
				<Stat label="runs" value={String(snapshot.runsTotal)} hint={`${snapshot.runs.length} in detail`} />
				<Stat label="storage" value={bytesOf(storage.total)} hint={`${files.length} files`} />
			</div>

			<section className={`flex flex-col gap-2 rounded-[7px] px-3.5 py-3 ${FILL}`}>
				<div className="flex items-baseline gap-2">
					<p className={`m-0 ${LABEL}`}>stages</p>
					<span className="flex-1" />
					<span className={`${NOTE} font-mono`}>last {snapshot.runs.length} runs</span>
				</div>
				{stages.length === 0 ? (
					<p className={`m-0 ${NOTE}`}>no runs yet — each finished stage leaves a line in runs.jsonl</p>
				) : (
					stages.map((row) => (
						<div key={row.stage} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
							<div className="flex min-w-0 items-center gap-2.5">
								<span className="flex w-[54px] shrink-0 items-center gap-1.5 font-serif text-[13px] leading-[1.2] text-ink">
									{running?.stage === row.stage ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent-teal" aria-hidden="true" /> : null}
									{row.stage}
								</span>
								<Share value={row.ok} total={row.runs} failed={row.runs - row.ok} />
								<span className={`${NOTE} shrink-0`}>
									{row.ok}/{row.runs}
								</span>
								<span className={`${NOTE} truncate`}>
									{row.atoms} atoms · {secondsOf(row.avgMs)}
								</span>
							</div>
							<span className={`${NOTE} whitespace-nowrap`}>
								{agoOf(row.last.startedAt)} <span className="text-muted-soft">·</span> <span className={toneOf(row.last.reason)}>{row.last.reason}</span>
							</span>
						</div>
					))
				)}
			</section>

			<section className="flex flex-col gap-2">
				<div className="flex items-baseline gap-2">
					<p className={`m-0 ${LABEL}`}>storage</p>
					<span className="flex-1" />
					<button
						type="button"
						aria-expanded={openFiles}
						onClick={() => setOpenFiles(!openFiles)}
						className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[9.5px] tabular-nums text-muted-soft hover:text-ink"
					>
						{openFiles ? "hide files" : `files ${files.length}`}
					</button>
				</div>
				<div className={`flex h-[4px] w-full overflow-hidden rounded-full ${TRACK}`}>
					<span className="block bg-ink/55" style={{ width: `${(results / total) * 100}%` }} />
					<span className="block bg-ink/20" style={{ width: `${(traces / total) * 100}%` }} />
				</div>
				<div className="flex items-baseline gap-3 font-mono text-[9.5px] tabular-nums">
					<span className="text-ink-soft">
						<span className="text-muted-soft">results </span>
						{bytesOf(results)}
					</span>
					<span className="text-ink-soft">
						<span className="text-muted-soft">traces </span>
						{bytesOf(traces)}
					</span>
					<span className="flex-1" />
					<span className="text-muted-soft">{bytesOf(storage.total)} total</span>
				</div>
				{openFiles ? <Files files={files} total={storage.total} /> : null}
			</section>

			<section className="flex flex-col gap-1.5">
				<p className={`m-0 ${LABEL}`}>limits</p>
				<p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[9.5px] tabular-nums">
					<Limit label="organize after" value={limits.pendingRounds > 0 ? `${limits.pendingRounds} rounds` : "off"} />
					<Limit label="recall" value={`${limits.recallDetail} / ${limits.recallTotal} chars`} />
					<Limit label="refuse after" value={`${limits.maxMatches} matches`} />
					<Limit label="sops" value={String(limits.maxSops)} />
					<Limit label="digest" value={`${limits.digestItems} items`} />
				</p>
			</section>
		</div>
	);
}

function Limit(props: { label: string; value: string }) {
	return (
		<span>
			<span className="text-muted-soft">{props.label} </span>
			<span className="text-ink-soft">{props.value}</span>
		</span>
	);
}
