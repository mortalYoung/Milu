import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Tip } from "../host/tooltip.tsx";
import type { MemoryOverview } from "../memory/overview.ts";
import { LoadingLines, Skeleton } from "./skeleton.tsx";
import { convTime, formatBytes } from "./utils.ts";

const EYEBROW = "ext-details-caption";
const KIND_CHIP = "ext-mem-chip";
const ROW_BUTTON = "ext-mem-row";

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
		<section className="ext-details-card">
			<button type="button" className="ext-details-head-row" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className={EYEBROW}>Memory</span>
				<span className="ext-details-summary">{summary}</span>
				{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
			</button>

			{open && props.loading && !overview ? (
				<div className="ext-mem-body">
					<LoadingLines rows={4} />
				</div>
			) : null}

			{open && overview ? (
				<div className="ext-mem-body">
					<div className="ext-mem-section">
						<div className="ext-mem-line">
							<span className={EYEBROW}>Storage</span>
							<span className="ext-mem-value">{formatBytes(overview.totalBytes)}</span>
						</div>
						<div className="ext-mem-bar" role="img" aria-label={`storage: results ${share(overview.resultsBytes).toFixed(0)}%, trace ${share(overview.traceBytes).toFixed(0)}%`}>
							{overview.resultsBytes > 0 ? <span className="ext-mem-bar-results" style={{ width: `${share(overview.resultsBytes)}%` }} /> : null}
							{overview.traceBytes > 0 ? <span className="ext-mem-bar-trace" style={{ width: `${share(overview.traceBytes)}%` }} /> : null}
						</div>
						<Tip label={fileTooltip(overview.results)}>
							<div className="ext-mem-line">
								<span>Results</span>
								<span className="ext-mem-value">
									{formatBytes(overview.resultsBytes)} · {share(overview.resultsBytes).toFixed(0)}%
								</span>
							</div>
						</Tip>
						<Tip label={fileTooltip(overview.trace)}>
							<div className="ext-mem-line">
								<span>Trace log</span>
								<span className="ext-mem-value">
									{formatBytes(overview.traceBytes)} · {share(overview.traceBytes).toFixed(0)}%
								</span>
							</div>
						</Tip>
						<p className="ext-mem-note">
							{overview.pending.pending ? `${overview.pending.rounds} rounds not extracted yet` : "all extracted"} · {overview.runsTotal} run(s) logged
						</p>
					</div>

					<div className="ext-mem-section">
						<div className="ext-mem-line">
							<span className={EYEBROW}>Records</span>
							<span className="ext-mem-value">
								{overview.records.length}
								{overview.supersededCount > 0 ? ` · ${overview.supersededCount} superseded` : ""}
							</span>
						</div>
						{overview.records.length > 0 ? (
							<div className="ext-mem-list">
								{overview.records.map((record) => (
									<div key={record.id}>
										<button
											type="button"
											className={ROW_BUTTON}
											aria-expanded={openRecord === record.id}
											onClick={() => setOpenRecord(openRecord === record.id ? null : record.id)}
										>
											<span className={KIND_CHIP}>{record.kind}</span>
											<span className={record.superseded ? "ext-mem-text is-superseded" : "ext-mem-text"}>{record.summary}</span>
											{record.overRecallCap ? (
												<Tip label={`detail is longer than the ${overview.agentDetailLimit} chars the agent can recall`}>
													<span className="ext-mem-truncated">truncated</span>
												</Tip>
											) : null}
											<span className="ext-mem-time">{convTime(record.createdAt)}</span>
										</button>
										{openRecord === record.id ? (
											<div className="ext-mem-detail">
												{record.detail ? <p>{record.detail}</p> : <p className="ext-mem-time">—</p>}
												{record.overRecallCap ? <p className="ext-mem-truncated">the agent only ever recalls the first {overview.agentDetailLimit} chars of this detail</p> : null}
												<p className="ext-mem-time">
													{record.sourceCount} raw entries{record.scene ? ` · ${record.scene}` : ""}
												</p>
											</div>
										) : null}
									</div>
								))}
							</div>
						) : (
							<p className="ext-mem-time">—</p>
						)}
					</div>

					<div className="ext-mem-section">
						<div className="ext-mem-line">
							<span className={EYEBROW}>Scenes & profile</span>
							<span className="ext-mem-value">{overview.scenes.length}</span>
						</div>
						{overview.scenes.length > 0 ? (
							<div className="ext-mem-list">
								{overview.scenes.map((scene) => (
									<div key={scene.sceneId}>
										<button
											type="button"
											className={ROW_BUTTON}
											aria-expanded={openScene === scene.sceneId}
											onClick={() => setOpenScene(openScene === scene.sceneId ? null : scene.sceneId)}
										>
											<span className="ext-mem-text">{scene.name}</span>
											<span className="ext-mem-time">
												{scene.sourceCount} memories · heat {scene.heat}
											</span>
										</button>
										{openScene === scene.sceneId ? (
											<p className="ext-mem-detail-text">
												{scene.summary}
												{scene.content ? `\n\n${scene.content}` : ""}
											</p>
										) : null}
									</div>
								))}
							</div>
						) : (
							<p className="ext-mem-time">—</p>
						)}
						{overview.profile ? (
							<>
								<button type="button" className={`${ROW_BUTTON} is-boxed`} aria-expanded={showProfile} onClick={() => setShowProfile(!showProfile)}>
									<span className="ext-mem-text">Profile</span>
									<span className="ext-mem-time">
										v{overview.profile.version} · {overview.profile.sourceCount} scenes · {convTime(overview.profile.createdAt)}
									</span>
								</button>
								{showProfile ? <p className="ext-mem-detail-text is-boxed">{overview.profile.content}</p> : null}
							</>
						) : (
							<p className="ext-mem-detail-text is-boxed">
								<span className="ext-mem-text">Profile</span>—
							</p>
						)}
					</div>

					<div className="ext-mem-section">
						<div className="ext-mem-line">
							<span className={EYEBROW}>Trace</span>
							<span className="ext-mem-value">
								{overview.runs.length} of {overview.runsTotal}
							</span>
						</div>
						{overview.runs.length > 0 ? (
							<div className="ext-mem-list">
								{overview.runs.map((run) => (
									<div className="ext-mem-run" key={run.runId}>
										<span className="ext-mem-time">{convTime(run.startedAt)}</span>
										<span className={KIND_CHIP}>{run.stage}</span>
										<span className={run.reason === "completed" ? "ext-mem-time" : "ext-mem-error"}>{run.reason}</span>
										<span className="ext-mem-time">+{run.added}</span>
										<span className="ext-mem-time">{(run.durationMs / 1000).toFixed(1)}s</span>
										{run.error ? (
											<Tip label={run.error}>
												<span className="ext-mem-error">error</span>
											</Tip>
										) : null}
									</div>
								))}
							</div>
						) : (
							<p className="ext-mem-time">—</p>
						)}
					</div>
				</div>
			) : null}
		</section>
	);
}
