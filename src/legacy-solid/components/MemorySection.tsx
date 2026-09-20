import { ChevronDown, ChevronRight } from "lucide-solid";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { MemoryRecordView, MemoryRunView } from "../../shared/rpc";
import { convTime } from "../lib/chat-preview";
import { rpc } from "../lib/rpc";
import { formatTokens } from "../lib/utils";
import { MemoryTrajectoryDialog } from "./MemoryTrajectoryDialog";

const EYEBROW = "font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted";
const CARD = "border border-hairline bg-letter rounded-md";
const KIND_CHIP = "shrink-0 rounded-[3px] border border-hairline px-1 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em] text-body-muted";
const ROW_BUTTON = "memory-row flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-paper-hover";

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
	const [open, setOpen] = createSignal(false);
	const [openRecord, setOpenRecord] = createSignal<string | null>(null);
	const [openScene, setOpenScene] = createSignal<string | null>(null);
	const [showProfile, setShowProfile] = createSignal(false);
	const [openRun, setOpenRun] = createSignal<MemoryRunView | null>(null);
	const [overview] = createResource(
		() => props.partner,
		(name) => rpc.request.memory_overview({ name }).then((res) => res.overview),
	);

	const summary = createMemo(() => {
		const data = overview();
		if (!data) return "—";
		if (data.records.length === 0 && data.scenes.length === 0 && data.runsTotal === 0) return "—";
		const parts = [formatBytes(data.totalBytes), `${data.records.length} record${data.records.length === 1 ? "" : "s"}`];
		if (data.scenes.length > 0) parts.push(`${data.scenes.length} scenes`);
		const last = data.runs[0];
		parts.push(last ? `last run ${convTime(last.startedAt)}` : "no runs yet");
		return parts.join(" · ");
	});

	const percent = (part: number) => {
		const total = overview()?.totalBytes ?? 0;
		return total > 0 ? (part / total) * 100 : 0;
	};

	return (
		<div class={CARD}>
			<button type="button" class="card-head flex w-full items-center gap-2 rounded-t-[5px] px-3 py-2.5 text-left" aria-expanded={open()} onClick={() => setOpen(!open())}>
				<span class={EYEBROW}>Memory</span>
				<span class="min-w-0 flex-1 truncate font-mono text-[10.5px] text-body-muted">{summary()}</span>
				<Show when={open()} fallback={<ChevronRight size={14} class="shrink-0 text-muted" />}>
					<ChevronDown size={14} class="shrink-0 text-muted" />
				</Show>
			</button>

			<Show when={open() && overview()}>
				{(data) => (
					<div class="flex flex-col gap-2.5 border-t border-hairline p-3">
						<section class="flex flex-col gap-1.5">
							<div class="flex items-baseline gap-2">
								<span class={EYEBROW}>Storage</span>
								<span class="ml-auto font-mono text-[11px] tabular-nums text-ink">{formatBytes(data().totalBytes)}</span>
							</div>
							<div
								class="flex h-1.5 overflow-hidden rounded-full bg-ink/10"
								role="img"
								aria-label={`storage: results ${percent(data().resultsBytes).toFixed(0)}%, trace ${percent(data().traceBytes).toFixed(0)}%`}
							>
								<Show when={data().resultsBytes > 0}>
									<span class="bg-seal" style={{ width: `${percent(data().resultsBytes)}%`, "min-width": "3px" }} />
								</Show>
								<Show when={data().traceBytes > 0}>
									<span class="bg-ink/25" style={{ width: `${percent(data().traceBytes)}%`, "min-width": "3px" }} />
								</Show>
							</div>
							<div class="flex items-baseline gap-2 font-mono text-[10.5px] tabular-nums" title={fileTooltip(data().results)}>
								<span class="text-ink">Results</span>
								<span class="ml-auto text-body-muted">
									{formatBytes(data().resultsBytes)} · {percent(data().resultsBytes).toFixed(0)}%
								</span>
							</div>
							<div class="flex items-baseline gap-2 font-mono text-[10.5px] tabular-nums" title={fileTooltip(data().trace)}>
								<span class="text-ink">Trace log</span>
								<span class="ml-auto text-body-muted">
									{formatBytes(data().traceBytes)} · {percent(data().traceBytes).toFixed(0)}%
								</span>
							</div>
							<p class="font-sans text-[10px] text-muted">
								{data().pending.pending ? `${data().pending.rounds} rounds not extracted yet` : "all extracted"} · {data().runsTotal} run(s) logged
							</p>
						</section>

						<section class="flex flex-col gap-1.5">
							<div class="flex items-baseline gap-2">
								<span class={EYEBROW}>Records</span>
								<span class="ml-auto font-mono text-[10.5px] tabular-nums text-muted">
									{data().records.length}
									<Show when={data().supersededCount > 0}> · {data().supersededCount} superseded</Show>
								</span>
							</div>
							<Show when={data().records.length > 0} fallback={<p class="font-mono text-[11px] text-muted">—</p>}>
								<div class="max-h-[260px] divide-y divide-hairline overflow-y-auto rounded border border-hairline">
									<For each={data().records}>
										{(record: MemoryRecordView) => (
											<div>
												<button
													type="button"
													class={ROW_BUTTON}
													aria-expanded={openRecord() === record.id}
													onClick={() => setOpenRecord(openRecord() === record.id ? null : record.id)}
												>
													<span class={KIND_CHIP}>{record.kind}</span>
													<span class={"min-w-0 flex-1 truncate font-sans text-[12px] " + (record.superseded ? "text-muted line-through" : "text-ink")}>{record.summary}</span>
													<Show when={record.overRecallCap}>
														<span class="shrink-0 font-mono text-[9.5px] text-seal" title={`detail is longer than the ${data().agentDetailLimit} chars the agent can recall`}>
															truncated
														</span>
													</Show>
													<span class="shrink-0 font-mono text-[10px] tabular-nums text-muted">{convTime(record.createdAt)}</span>
												</button>
												<Show when={openRecord() === record.id}>
													<div class="flex flex-col gap-1.5 px-3 pb-2.5">
														<Show when={record.detail} fallback={<p class="font-mono text-[11px] text-muted">—</p>}>
															<p class="whitespace-pre-wrap break-words font-sans text-[11.5px] leading-[1.6] text-body-muted">{record.detail}</p>
														</Show>
														<Show when={record.overRecallCap}>
															<p class="font-sans text-[10px] text-seal">the agent only ever recalls the first {data().agentDetailLimit} chars of this detail</p>
														</Show>
														<p class="font-mono text-[10px] text-muted">
															{record.source.rawCount} raw entries
															{record.scene ? ` · ${record.scene}` : ""}
														</p>
													</div>
												</Show>
											</div>
										)}
									</For>
								</div>
							</Show>
						</section>

						<section class="flex flex-col gap-1.5">
							<div class="flex items-baseline gap-2">
								<span class={EYEBROW}>Scenes & profile</span>
								<span class="ml-auto font-mono text-[10.5px] tabular-nums text-muted">{data().scenes.length}</span>
							</div>
							<Show when={data().scenes.length > 0} fallback={<p class="font-mono text-[11px] text-muted">—</p>}>
								<div class="flex flex-col divide-y divide-hairline rounded border border-hairline">
									<For each={data().scenes}>
										{(scene) => (
											<div>
												<Show
													when={scene.summary || scene.content}
													fallback={
														<div class={ROW_BUTTON}>
															<span class="min-w-0 flex-1 truncate font-sans text-[12px] text-ink">{scene.name}</span>
															<span class="shrink-0 font-mono text-[10px] tabular-nums text-muted">
																{scene.sourceCount} memories · heat {scene.heat}
															</span>
														</div>
													}
												>
													<button
														type="button"
														class={ROW_BUTTON}
														aria-expanded={openScene() === scene.sceneId}
														onClick={() => setOpenScene(openScene() === scene.sceneId ? null : scene.sceneId)}
													>
														<span class="min-w-0 flex-1 truncate font-sans text-[12px] text-ink">{scene.name}</span>
														<span class="shrink-0 font-mono text-[10px] tabular-nums text-muted">
															{scene.sourceCount} memories · heat {scene.heat}
														</span>
													</button>
												</Show>
												<Show when={openScene() === scene.sceneId}>
													<p class="whitespace-pre-wrap break-words px-3 pb-2.5 font-sans text-[11.5px] leading-[1.6] text-body-muted">
														{scene.summary}
														{scene.content ? `\n\n${scene.content}` : ""}
													</p>
												</Show>
											</div>
										)}
									</For>
								</div>
							</Show>
							<Show
								when={data().profile}
								fallback={
									<p class="rounded border border-hairline px-3 py-1.5 font-mono text-[10.5px] text-muted">
										<span class="mr-2 font-sans text-[12px] text-ink">Profile</span>—
									</p>
								}
							>
								{(profile) => (
									<>
										<button type="button" class={ROW_BUTTON + " rounded border border-hairline"} aria-expanded={showProfile()} onClick={() => setShowProfile(!showProfile())}>
											<span class="min-w-0 flex-1 truncate font-sans text-[12px] text-ink">Profile</span>
											<span class="shrink-0 font-mono text-[10px] text-muted">
												v{profile().version} · {profile().sourceCount} scenes · {convTime(profile().createdAt)}
											</span>
										</button>
										<Show when={showProfile()}>
											<p class="whitespace-pre-wrap break-words rounded border border-hairline bg-paper px-2 py-1.5 font-sans text-[11.5px] leading-[1.6] text-body-muted">
												{profile().content}
											</p>
										</Show>
									</>
								)}
							</Show>
						</section>

						<section class="flex flex-col gap-1.5">
							<div class="flex items-baseline gap-2">
								<span class={EYEBROW}>Trace</span>
								<span class="ml-auto font-mono text-[10.5px] tabular-nums text-muted">
									{data().runs.length} of {data().runsTotal}
								</span>
							</div>
							<Show when={data().runs.length > 0} fallback={<p class="font-mono text-[11px] text-muted">—</p>}>
								<div class="flex max-h-[260px] flex-col divide-y divide-hairline overflow-y-auto rounded border border-hairline">
									<For each={data().runs}>
										{(run) => (
											<div class="flex items-baseline gap-2 px-3 py-1.5 font-mono text-[10.5px] tabular-nums">
												<span class="shrink-0 text-muted">{convTime(run.startedAt)}</span>
												<span class={KIND_CHIP}>{run.stage}</span>
												<span class={"shrink-0 " + (run.reason === "completed" ? "text-body-muted" : "text-seal")}>{run.reason}</span>
												<span class="shrink-0 text-muted">+{run.added}</span>
												<span class="shrink-0 text-muted">{(run.durationMs / 1000).toFixed(1)}s</span>
												<Show when={run.usage}>
													{(usage) => (
														<span
															class="shrink-0 text-muted"
															title={`${usage().calls} calls · in ${usage().input} · out ${usage().output} · cache read ${usage().cacheRead} · cache write ${usage().cacheWrite}`}
														>
															{formatTokens(usage().input + usage().output + usage().cacheRead + usage().cacheWrite)} tok
														</span>
													)}
												</Show>
												<span class="ml-auto shrink-0 text-muted">{formatBytes(run.bytes)}</span>
												<button
													type="button"
													class="shrink-0 rounded px-1 font-sans text-[10px] text-seal hover:bg-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													onClick={() => setOpenRun(run)}
												>
													Trajectory
												</button>
											</div>
										)}
									</For>
								</div>
							</Show>
						</section>
					</div>
				)}
			</Show>

			<MemoryTrajectoryDialog partner={props.partner} run={openRun()} onClose={() => setOpenRun(null)} />
		</div>
	);
}
