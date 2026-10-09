import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { MemoryRecordView, MemoryRunView } from "../../shared/rpc";
import { convTime } from "../lib/chat-preview";
import { rpc } from "../lib/rpc";
import { formatTokens } from "../lib/utils";
import { MemoryTrajectoryDialog } from "./MemoryTrajectoryDialog";

const EYEBROW = "font-sans text-[12px] font-semibold uppercase tracking-[0.12em] text-muted";
const CARD = "border border-line bg-surface rounded-md";
const KIND_CHIP = "shrink-0 rounded-[4px] border border-line px-1 py-[1px] font-mono text-[12px] uppercase tracking-[0.06em] text-muted";
const ROW_BUTTON = "memory-row flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-hover";

type Overview = Awaited<ReturnType<typeof rpc.request.memory_overview>>["overview"];

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "—";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTooltip(files: { label: string; bytes: number }[]): string {
	return files.map((file) => `${file.label} · ${formatBytes(file.bytes)}`).join("\n");
}

export function MemorySection(props: { partner: string }) {
	const [open, setOpen] = useState(false);
	const [openRecord, setOpenRecord] = useState<string | null>(null);
	const [openScene, setOpenScene] = useState<string | null>(null);
	const [showProfile, setShowProfile] = useState(false);
	const [openRun, setOpenRun] = useState<MemoryRunView | null>(null);
	const [overview, setOverview] = useState<Overview | null>(null);

	useEffect(() => {
		let cancelled = false;
		setOverview(null);
		void rpc.request.memory_overview({ name: props.partner }).then((res) => {
			if (!cancelled) setOverview(res.overview);
		});
		return () => {
			cancelled = true;
		};
	}, [props.partner]);

	const summary = (() => {
		if (!overview) return "—";
		if (overview.records.length === 0 && overview.scenes.length === 0 && overview.runsTotal === 0) return "—";
		const parts = [formatBytes(overview.totalBytes), `${overview.records.length} record${overview.records.length === 1 ? "" : "s"}`];
		if (overview.scenes.length > 0) parts.push(`${overview.scenes.length} scenes`);
		const last = overview.runs[0];
		parts.push(last ? `last run ${convTime(last.startedAt)}` : "no runs yet");
		return parts.join(" · ");
	})();

	const percent = (part: number) => {
		const total = overview?.totalBytes ?? 0;
		return total > 0 ? (part / total) * 100 : 0;
	};

	return (
		<div className={CARD}>
			<button type="button" className="card-head flex w-full items-center gap-2 rounded-t-[5px] px-3 py-2.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className={EYEBROW}>Memory</span>
				<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{summary}</span>
				{open ? <ChevronDown size={14} className="shrink-0 text-muted-soft" /> : <ChevronRight size={14} className="shrink-0 text-muted" />}
			</button>

			{open && overview && (
				<div className="flex flex-col gap-2.5 border-t border-line p-3">
					<section className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2">
							<span className={EYEBROW}>Storage</span>
							<span className="ml-auto font-mono text-[12px] tabular-nums text-ink">{formatBytes(overview.totalBytes)}</span>
						</div>
						<div
							className="flex h-1.5 overflow-hidden rounded-full bg-ink/10"
							role="img"
							aria-label={`storage: results ${percent(overview.resultsBytes).toFixed(0)}%, trace ${percent(overview.traceBytes).toFixed(0)}%`}
						>
							{overview.resultsBytes > 0 && <span className="bg-ink" style={{ width: `${percent(overview.resultsBytes)}%`, minWidth: "3px" }} />}
							{overview.traceBytes > 0 && <span className="bg-ink/25" style={{ width: `${percent(overview.traceBytes)}%`, minWidth: "3px" }} />}
						</div>
						<div className="flex items-baseline gap-2 font-mono text-[12px] tabular-nums" title={fileTooltip(overview.results)}>
							<span className="text-ink">Results</span>
							<span className="ml-auto text-muted">
								{formatBytes(overview.resultsBytes)} · {percent(overview.resultsBytes).toFixed(0)}%
							</span>
						</div>
						<div className="flex items-baseline gap-2 font-mono text-[12px] tabular-nums" title={fileTooltip(overview.trace)}>
							<span className="text-ink">Trace log</span>
							<span className="ml-auto text-muted">
								{formatBytes(overview.traceBytes)} · {percent(overview.traceBytes).toFixed(0)}%
							</span>
						</div>
						<p className="font-sans text-[10px] text-muted">
							{overview.pending.pending ? `${overview.pending.rounds} rounds not extracted yet` : "all extracted"} · {overview.runsTotal} run(s) logged
						</p>
					</section>

					<section className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2">
							<span className={EYEBROW}>Records</span>
							<span className="ml-auto font-mono text-[12px] tabular-nums text-muted">
								{overview.records.length}
								{overview.supersededCount > 0 && ` · ${overview.supersededCount} superseded`}
							</span>
						</div>
						{overview.records.length > 0 ? (
							<div className="max-h-[260px] divide-y divide-line overflow-y-auto rounded-md border border-line">
								{overview.records.map((record: MemoryRecordView) => (
									<div key={record.id}>
										<button
											type="button"
											className={ROW_BUTTON}
											aria-expanded={openRecord === record.id}
											onClick={() => setOpenRecord(openRecord === record.id ? null : record.id)}
										>
											<span className={KIND_CHIP}>{record.kind}</span>
											<span className={"min-w-0 flex-1 truncate font-sans text-[13px] " + (record.superseded ? "text-muted line-through" : "text-ink")}>{record.summary}</span>
											{record.overRecallCap && (
												<span className="shrink-0 font-mono text-[12px] text-signal" title={`detail is longer than the ${overview.agentDetailLimit} chars the agent can recall`}>
													truncated
												</span>
											)}
											<span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">{convTime(record.createdAt)}</span>
										</button>
										{openRecord === record.id && (
											<div className="flex flex-col gap-1.5 px-3 pb-2.5">
												{record.detail ? (
													<p className="whitespace-pre-wrap break-words font-sans text-[12px] leading-[1.6] text-muted">{record.detail}</p>
												) : (
													<p className="font-mono text-[12px] text-muted">—</p>
												)}
												{record.overRecallCap && (
													<p className="font-sans text-[10px] text-signal">the agent only ever recalls the first {overview.agentDetailLimit} chars of this detail</p>
												)}
												<p className="font-mono text-[10px] text-muted">
													{record.source.rawCount} raw entries
													{record.scene ? ` · ${record.scene}` : ""}
												</p>
											</div>
										)}
									</div>
								))}
							</div>
						) : (
							<p className="font-mono text-[12px] text-muted">—</p>
						)}
					</section>

					<section className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2">
							<span className={EYEBROW}>Scenes & profile</span>
							<span className="ml-auto font-mono text-[12px] tabular-nums text-muted">{overview.scenes.length}</span>
						</div>
						{overview.scenes.length > 0 ? (
							<div className="flex flex-col divide-y divide-line rounded-md border border-line">
								{overview.scenes.map((scene) => (
									<div key={scene.sceneId}>
										{scene.summary || scene.content ? (
											<button
												type="button"
												className={ROW_BUTTON}
												aria-expanded={openScene === scene.sceneId}
												onClick={() => setOpenScene(openScene === scene.sceneId ? null : scene.sceneId)}
											>
												<span className="min-w-0 flex-1 truncate font-sans text-[13px] text-ink">{scene.name}</span>
												<span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
													{scene.sourceCount} memories · heat {scene.heat}
												</span>
											</button>
										) : (
											<div className={ROW_BUTTON}>
												<span className="min-w-0 flex-1 truncate font-sans text-[13px] text-ink">{scene.name}</span>
												<span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
													{scene.sourceCount} memories · heat {scene.heat}
												</span>
											</div>
										)}
										{openScene === scene.sceneId && (
											<p className="whitespace-pre-wrap break-words px-3 pb-2.5 font-sans text-[12px] leading-[1.6] text-muted">
												{scene.summary}
												{scene.content ? `\n\n${scene.content}` : ""}
											</p>
										)}
									</div>
								))}
							</div>
						) : (
							<p className="font-mono text-[12px] text-muted">—</p>
						)}
						{overview.profile ? (
							<>
								<button type="button" className={ROW_BUTTON + " rounded-md border border-line"} aria-expanded={showProfile} onClick={() => setShowProfile(!showProfile)}>
									<span className="min-w-0 flex-1 truncate font-sans text-[13px] text-ink">Profile</span>
									<span className="shrink-0 font-mono text-[10px] text-muted">
										v{overview.profile.version} · {overview.profile.sourceCount} scenes · {convTime(overview.profile.createdAt)}
									</span>
								</button>
								{showProfile && (
									<p className="whitespace-pre-wrap break-words rounded-md border border-line bg-canvas px-2 py-1.5 font-sans text-[12px] leading-[1.6] text-muted">
										{overview.profile.content}
									</p>
								)}
							</>
						) : (
							<p className="rounded-md border border-line px-3 py-1.5 font-mono text-[12px] text-muted">
								<span className="mr-2 font-sans text-[13px] text-ink">Profile</span>—
							</p>
						)}
					</section>

					<section className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2">
							<span className={EYEBROW}>Trace</span>
							<span className="ml-auto font-mono text-[12px] tabular-nums text-muted">
								{overview.runs.length} of {overview.runsTotal}
							</span>
						</div>
						{overview.runs.length > 0 ? (
							<div className="flex max-h-[260px] flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
								{overview.runs.map((run) => (
									<div className="flex items-baseline gap-2 px-3 py-1.5 font-mono text-[12px] tabular-nums" key={run.runId}>
										<span className="shrink-0 text-muted">{convTime(run.startedAt)}</span>
										<span className={KIND_CHIP}>{run.stage}</span>
										<span className={"shrink-0 " + (run.reason === "completed" ? "text-muted" : "text-signal")}>{run.reason}</span>
										<span className="shrink-0 text-muted">+{run.added}</span>
										<span className="shrink-0 text-muted">{(run.durationMs / 1000).toFixed(1)}s</span>
										{run.usage && (
											<span
												className="shrink-0 text-muted"
												title={`${run.usage.calls} calls · in ${run.usage.input} · out ${run.usage.output} · cache read ${run.usage.cacheRead} · cache write ${run.usage.cacheWrite}`}
											>
												{formatTokens(run.usage.input + run.usage.output + run.usage.cacheRead + run.usage.cacheWrite)} tok
											</span>
										)}
										<span className="ml-auto shrink-0 text-muted">{formatBytes(run.bytes)}</span>
										<button
											type="button"
											className="shrink-0 rounded-md px-1 font-sans text-[10px] text-ink-soft hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											onClick={() => setOpenRun(run)}
										>
											Trajectory
										</button>
									</div>
								))}
							</div>
						) : (
							<p className="font-mono text-[12px] text-muted">—</p>
						)}
					</section>
				</div>
			)}

			<MemoryTrajectoryDialog partner={props.partner} run={openRun} onClose={() => setOpenRun(null)} />
		</div>
	);
}
