import { Tip } from "@milu/window/api/tooltip";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { MemoryOverview } from "../../memory/overview.ts";
import { CARD, EYEBROW, HEAD_ROW, SUMMARY } from "../chrome.ts";
import { convTime, formatBytes } from "../utils.ts";
import { LoadingLines, Skeleton } from "./skeleton.tsx";

const CHIP = "shrink-0 rounded-[4px] border-[0.5px] border-line px-1 font-mono text-[10px] tracking-[0.06em] text-muted uppercase";
const ROW = "flex w-full cursor-pointer items-baseline gap-1.5 bg-transparent px-2.5 py-1.5 text-left hover:bg-hover";
const TEXT = "min-w-0 flex-1 overflow-hidden font-sans text-[13px] text-ellipsis whitespace-nowrap text-ink";
const TIME = "shrink-0 font-mono text-[10px] text-muted";
const TRUNCATED = "shrink-0 font-mono text-[10px] text-signal";
const PROSE = "m-0 text-[11px] leading-[1.6] text-muted whitespace-pre-wrap [overflow-wrap:anywhere]";
const LIST = "flex max-h-[260px] flex-col overflow-y-auto rounded-md border-[0.5px] border-line [&>div+div]:border-t-[0.5px] [&>div+div]:border-line";

function fileTooltip(files: readonly { label: string; bytes: number }[]): string {
	return files.map((file) => `${file.label} · ${formatBytes(file.bytes)}`).join("\n");
}

export function MemorySection(props: { memory: MemoryOverview | null; loading?: boolean }) {
	const [open, setOpen] = useState(true);
	const [openRecord, setOpenRecord] = useState<string | null>(null);
	const [openScene, setOpenScene] = useState<string | null>(null);
	const [showProfile, setShowProfile] = useState(false);
	const overview = props.memory;

	const summary = (() => {
		if (!overview) return props.loading ? <Skeleton width={150} height={10} /> : "—";
		if (overview.records.length === 0 && overview.scenes.length === 0 && overview.runsTotal === 0) return "—";
		const parts = [formatBytes(overview.totalBytes), `${overview.records.length} record${overview.records.length === 1 ? "" : "s"}`];
		if (overview.scenes.length > 0) parts.push(`${overview.scenes.length} scenes`);
		const last = overview.runs[0];
		parts.push(last ? `last run ${convTime(last.startedAt)}` : "no runs yet");
		return parts.join(" · ");
	})();

	const share = (part: number) => {
		const total = overview?.totalBytes ?? 0;
		return total > 0 ? (part / total) * 100 : 0;
	};

	return (
		<section className={CARD}>
			<button type="button" className={HEAD_ROW} aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className={EYEBROW}>Memory</span>
				<span className={SUMMARY}>{summary}</span>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
			</button>

			{open && props.loading && !overview ? (
				<div className="flex flex-col gap-2.5 border-t-[0.5px] border-line px-3 pt-2.5 pb-3">
					<LoadingLines rows={4} />
				</div>
			) : null}

			{open && overview ? (
				<div className="flex flex-col gap-2.5 border-t-[0.5px] border-line px-3 pt-2.5 pb-3">
					<div className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2 font-mono text-[11px] text-ink">
							<span className={EYEBROW}>Storage</span>
							<span className="ml-auto whitespace-nowrap text-muted">{formatBytes(overview.totalBytes)}</span>
						</div>
						<div
							className="flex h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]"
							role="img"
							aria-label={`storage: results ${share(overview.resultsBytes).toFixed(0)}%, trace ${share(overview.traceBytes).toFixed(0)}%`}
						>
							{overview.resultsBytes > 0 ? <span className="min-w-[3px] bg-ink" style={{ width: `${share(overview.resultsBytes)}%` }} /> : null}
							{overview.traceBytes > 0 ? (
								<span className="min-w-[3px] bg-[color-mix(in_srgb,var(--ink)_25%,transparent)]" style={{ width: `${share(overview.traceBytes)}%` }} />
							) : null}
						</div>
						<Tip label={fileTooltip(overview.results)}>
							<div className="flex items-baseline gap-2 font-mono text-[11px] text-ink">
								<span>Results</span>
								<span className="ml-auto whitespace-nowrap text-muted">
									{formatBytes(overview.resultsBytes)} · {share(overview.resultsBytes).toFixed(0)}%
								</span>
							</div>
						</Tip>
						<Tip label={fileTooltip(overview.trace)}>
							<div className="flex items-baseline gap-2 font-mono text-[11px] text-ink">
								<span>Trace log</span>
								<span className="ml-auto whitespace-nowrap text-muted">
									{formatBytes(overview.traceBytes)} · {share(overview.traceBytes).toFixed(0)}%
								</span>
							</div>
						</Tip>
						<p className="m-0 text-[10px] text-muted">
							{overview.pending.pending ? `${overview.pending.rounds} rounds not extracted yet` : "all extracted"} · {overview.runsTotal} run(s) logged
						</p>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2 font-mono text-[11px] text-ink">
							<span className={EYEBROW}>Records</span>
							<span className="ml-auto whitespace-nowrap text-muted">
								{overview.records.length}
								{overview.supersededCount > 0 ? ` · ${overview.supersededCount} superseded` : ""}
							</span>
						</div>
						{overview.records.length > 0 ? (
							<div className={LIST}>
								{overview.records.map((record) => (
									<div key={record.id}>
										<button type="button" className={ROW} aria-expanded={openRecord === record.id} onClick={() => setOpenRecord(openRecord === record.id ? null : record.id)}>
											<span className={CHIP}>{record.kind}</span>
											<span className={record.superseded ? `${TEXT} text-muted line-through` : TEXT}>{record.summary}</span>
											{record.overRecallCap ? (
												<Tip label={`detail is longer than the ${overview.agentDetailLimit} chars the agent can recall`}>
													<span className={TRUNCATED}>truncated</span>
												</Tip>
											) : null}
											<span className={TIME}>{convTime(record.createdAt)}</span>
										</button>
										{openRecord === record.id ? (
											<div className="flex flex-col gap-1 px-2 pb-2">
												{record.detail ? <p className={PROSE}>{record.detail}</p> : <p className={TIME}>—</p>}
												{record.overRecallCap ? <p className={TRUNCATED}>the agent only ever recalls the first {overview.agentDetailLimit} chars of this detail</p> : null}
												<p className={TIME}>
													{record.sourceCount} raw entries{record.scene ? ` · ${record.scene}` : ""}
												</p>
											</div>
										) : null}
									</div>
								))}
							</div>
						) : (
							<p className={TIME}>—</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2 font-mono text-[11px] text-ink">
							<span className={EYEBROW}>Scenes & profile</span>
							<span className="ml-auto whitespace-nowrap text-muted">{overview.scenes.length}</span>
						</div>
						{overview.scenes.length > 0 ? (
							<div className={LIST}>
								{overview.scenes.map((scene) => (
									<div key={scene.sceneId}>
										<button
											type="button"
											className={ROW}
											aria-expanded={openScene === scene.sceneId}
											onClick={() => setOpenScene(openScene === scene.sceneId ? null : scene.sceneId)}
										>
											<span className={TEXT}>{scene.name}</span>
											<span className={TIME}>
												{scene.sourceCount} memories · heat {scene.heat}
											</span>
										</button>
										{openScene === scene.sceneId ? (
											<p className={`${PROSE} px-2 pb-2`}>
												{scene.summary}
												{scene.content ? `\n\n${scene.content}` : ""}
											</p>
										) : null}
									</div>
								))}
							</div>
						) : (
							<p className={TIME}>—</p>
						)}
						{overview.profile ? (
							<>
								<button type="button" className={`${ROW} rounded-md border-[0.5px] border-line`} aria-expanded={showProfile} onClick={() => setShowProfile(!showProfile)}>
									<span className={TEXT}>Profile</span>
									<span className={TIME}>
										v{overview.profile.version} · {overview.profile.sourceCount} scenes · {convTime(overview.profile.createdAt)}
									</span>
								</button>
								{showProfile ? <p className={`${PROSE} rounded-md border-[0.5px] border-line px-2 py-1.5`}>{overview.profile.content}</p> : null}
							</>
						) : (
							<p className={`${PROSE} rounded-md border-[0.5px] border-line px-2 py-1.5`}>
								<span className={TEXT}>Profile</span>—
							</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-baseline gap-2 font-mono text-[11px] text-ink">
							<span className={EYEBROW}>Trace</span>
							<span className="ml-auto whitespace-nowrap text-muted">
								{overview.runs.length} of {overview.runsTotal}
							</span>
						</div>
						{overview.runs.length > 0 ? (
							<div className={LIST}>
								{overview.runs.map((run) => (
									<div className="flex items-baseline gap-1.5 px-2 py-[5px] font-mono text-[10px] text-muted" key={run.runId}>
										<span className={TIME}>{convTime(run.startedAt)}</span>
										<span className={CHIP}>{run.stage}</span>
										<span className={run.reason === "completed" ? TIME : TRUNCATED}>{run.reason}</span>
										<span className={TIME}>+{run.added}</span>
										<span className={TIME}>{(run.durationMs / 1000).toFixed(1)}s</span>
										{run.error ? (
											<Tip label={run.error}>
												<span className={TRUNCATED}>error</span>
											</Tip>
										) : null}
									</div>
								))}
							</div>
						) : (
							<p className={TIME}>—</p>
						)}
					</div>
				</div>
			) : null}
		</section>
	);
}
