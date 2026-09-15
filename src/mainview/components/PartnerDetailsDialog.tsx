import { ChevronDown, ChevronRight, ExternalLink } from "lucide-solid";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import { mcpStateColor } from "../lib/mcp";
import { rpc } from "../lib/rpc";
import { formatBytes, formatTokens } from "../lib/utils";
import { ActivityHeatmap, HEATMAP_WEEKS } from "./ActivityHeatmap";
import { Button } from "./Button";
import type { PartnerItem } from "./ConversationList";
import { EditorPathButton } from "./EditorPathButton";
import { MemorySection } from "./MemorySection";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from "./ui/tooltip";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const ACTIVITY_WINDOW = `${Math.round(HEATMAP_WEEKS / 4.345)} months`;
const ACTIVITY_WINDOW_SHORT = `${Math.round(HEATMAP_WEEKS / 4.345)}m`;

const FACT_LINE = "flex items-baseline justify-between gap-2";
const FACT_VALUE = "text-ink font-mono text-[10.5px] min-w-0 truncate";
const CARD = "border border-hairline bg-letter rounded-md";

function formatDate(ts: number): string {
	const d = new Date(ts);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function avatarInitial(name: string): string {
	const trimmed = name.trim();
	return trimmed ? trimmed[0].toUpperCase() : "?";
}

export function PartnerDetailsDialog(props: {
	partner: PartnerItem | null;
	onOpenChange: (open: boolean) => void;
	onOpenPath?: (path: string, editorId?: string) => void;
	editors?: { id: string; name: string }[];
}) {
	const p = () => props.partner;
	const [personaOpen, setPersonaOpen] = createSignal(false);
	const personaLine = () => p()?.persona?.trim().split("\n")[0] || "not set";

	const [days] = createResource(
		() => (p() ? p()!.name : null),
		async (name) => (await rpc.request.partner_activity({ name, weeks: HEATMAP_WEEKS })).days,
	);
	const [skills] = createResource(
		() => (p() ? p()!.name : null),
		async (name) => (await rpc.request.skill_list({ partner: name })).skills,
	);
	const [mcpGrants] = createResource(
		() => (p() ? p()!.name : null),
		async (name) => (await rpc.request.mcp_partner_grants({ name })).servers,
	);
	const [runtime] = createResource(
		() => (p() ? p()!.name : null),
		(name) => rpc.request.partner_runtime({ name }),
	);
	const [usage] = createResource(
		() => (p() ? p()!.name : null),
		(name) => rpc.request.partner_usage({ name }),
	);

	const metrics = createMemo(() => {
		const list = days() ?? [];
		return {
			activeDays: list.filter((d) => d.tokens > 0).length,
			turns: list.reduce((sum, d) => sum + d.turns, 0),
			tools: list.reduce((sum, d) => sum + d.tools, 0),
			tokens: list.reduce((sum, d) => sum + d.tokens, 0),
		};
	});

	const metricCards = () => [
		{ label: `Active days · ${ACTIVITY_WINDOW_SHORT}`, value: String(metrics().activeDays), delta: "tokens > 0" },
		{ label: `Turns · ${ACTIVITY_WINDOW_SHORT}`, value: formatTokens(metrics().turns), delta: `${formatTokens(metrics().tools)} tools` },
		{ label: `Tokens · ${ACTIVITY_WINDOW_SHORT}`, value: formatTokens(metrics().tokens), delta: `last ${ACTIVITY_WINDOW}` },
	];

	return (
		<Dialog open={p() != null} onOpenChange={props.onOpenChange}>
			<DialogContent focusClose class="w-[820px] max-w-[820px] bg-paper text-ink p-0 gap-0 overflow-hidden">
				<DialogTitle class="sr-only">{p()?.name ?? ""}</DialogTitle>
				{p() && (
					<div class="flex w-full max-h-[min(86vh,900px)] flex-col overflow-x-hidden">
						<div class="flex shrink-0 items-center gap-3 border-b border-hairline px-5 pt-4 pb-3 pr-12">
							<div class="size-10 rounded-md bg-ink text-paper flex items-center justify-center font-sans text-[18px] font-bold">{avatarInitial(p()!.name)}</div>
							<div class="min-w-0">
								<h2 class="font-sans text-[16px] font-semibold text-ink leading-tight">{p()!.name}</h2>
								<p class="font-sans text-[11px] text-body-muted truncate" title={p()!.path}>
									{p()!.path} · created {formatDate(p()!.createdAt)}
								</p>
							</div>
							<Show when={p()!.writing}>
								<span class="ml-auto font-sans text-[10px] font-medium text-seal border border-seal/30 bg-seal-soft rounded-[5px] px-2 py-1">● writing</span>
							</Show>
						</div>

						<div class="w-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
							<div class="grid grid-cols-3 gap-2.5 px-5 pt-2.5">
								<For each={metricCards()}>
									{(m) => (
										<div class="border border-hairline bg-letter rounded-md px-3 py-2.5">
											<div class="font-sans text-[9.5px] uppercase tracking-[0.1em] text-muted">{m.label}</div>
											<div class="font-mono text-[20px] text-ink leading-tight mt-1">{m.value}</div>
											<div class="font-mono text-[10px] text-seal mt-0.5">{m.delta}</div>
										</div>
									)}
								</For>
							</div>

							<div class="grid grid-cols-[1fr_240px] gap-2.5 px-5 pt-2.5 pb-2.5">
								<div class="flex min-w-0 flex-col gap-2.5">
									<div class={CARD}>
										<button
											type="button"
											class="card-head flex w-full items-center gap-2 rounded-t-[5px] px-3 py-2.5 text-left"
											aria-expanded={personaOpen()}
											onClick={() => setPersonaOpen(!personaOpen())}
										>
											<span class="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">Persona</span>
											<span class="min-w-0 flex-1 truncate font-sans text-[11px] text-body-muted">{personaLine()}</span>
											<Show when={personaOpen()} fallback={<ChevronRight size={14} class="shrink-0 text-muted" />}>
												<ChevronDown size={14} class="shrink-0 text-muted" />
											</Show>
										</button>
										<Show when={personaOpen()}>
											<div class="px-3 pb-3">
												<Show
													when={p()!.persona?.trim()}
													fallback={
														<div class="min-w-0">
															<p class="font-sans text-[12.5px] text-ink">No persona on file</p>
															<p class="mt-1 font-sans text-[12px] leading-[1.6] text-muted">
																A hand-written paragraph in <span class="font-mono text-[11px]">profile.json</span>, read as the partner's standing instructions.
															</p>
															<Button variant="link" size="sm" class="mt-1 -ml-3 [&_svg]:size-3" onClick={() => props.onOpenPath?.(p()!.path)}>
																Open partner folder <ExternalLink />
															</Button>
														</div>
													}
												>
													<div class="md font-sans text-[12.5px] leading-[1.65] text-ink" innerHTML={renderMarkdown(p()!.persona!)} />
												</Show>
											</div>
										</Show>
									</div>

									<div class={CARD + " p-3"}>
										<p class="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Activity · last {ACTIVITY_WINDOW}</p>
										<div class="activity-slot">
											<Show when={days()}>
												<ActivityHeatmap days={days()!} />
											</Show>
										</div>
									</div>
								</div>

								<div class={CARD + " p-3 min-w-0"}>
									<p class="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Status</p>
									<div class="grid gap-2 font-sans text-[11px]">
										<div>
											<div class="text-body-muted">Workspace</div>
											<Show when={runtime()?.workspace_path} fallback={<div class="text-muted">-</div>}>
												<EditorPathButton path={runtime()!.workspace_path!} max={30} class="font-mono text-[10.5px]" editors={props.editors} onOpenPath={props.onOpenPath} />
											</Show>
										</div>
										<div>
											<div class="text-body-muted">Storage</div>
											<Show when={runtime()?.storage_path} fallback={<div class="text-muted">-</div>}>
												<EditorPathButton path={runtime()!.storage_path!} max={30} class="font-mono text-[10.5px]" editors={props.editors} onOpenPath={props.onOpenPath} />
											</Show>
										</div>
										<div class={FACT_LINE}>
											<span class="text-body-muted">Size</span>
											<Tooltip openDelay={120} closeDelay={60} placement="top">
												<TooltipTrigger as="span" tabIndex={-1} class={FACT_VALUE}>
													<span class="underline decoration-dotted decoration-ink/30 underline-offset-2">{usage() ? formatBytes(usage()!.bytes) : "-"}</span>
												</TooltipTrigger>
												<TooltipPortal>
													<TooltipContent>
														{usage()?.parts.length
															? usage()!
																	.parts.slice(0, 3)
																	.map((part) => `${part.label} ${formatBytes(part.bytes)}`)
																	.join(" · ")
															: "no files yet"}
													</TooltipContent>
												</TooltipPortal>
											</Tooltip>
										</div>
										<div class={FACT_LINE}>
											<span class="text-body-muted">Model</span>
											<span class={FACT_VALUE} title={runtime()?.model ? `${runtime()!.model!.provider} · ${runtime()!.model!.modelId ?? "default"}` : undefined}>
												{runtime()?.model?.modelId ?? "default"}
											</span>
										</div>
										<div class={FACT_LINE}>
											<span class="text-body-muted">Effort</span>
											<span class={FACT_VALUE}>{runtime()?.thinking_level ?? "-"}</span>
										</div>
										<div class={FACT_LINE}>
											<span class="text-body-muted">Sandbox</span>
											<span class={FACT_VALUE}>{runtime()?.sandbox_mode ?? "-"}</span>
										</div>
										<div>
											<div class="text-body-muted">Skills</div>
											<Show when={skills() && skills()!.length > 0} fallback={<div class="text-muted">none granted</div>}>
												<ul class="mt-1 flex flex-col gap-1">
													<For each={skills()}>
														{(s) => (
															<li class="w-fit rounded border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-body-muted">
																{s.name} <span class="text-muted">· {s.scope}</span>
															</li>
														)}
													</For>
												</ul>
											</Show>
										</div>
										<div>
											<div class="text-body-muted">MCP servers</div>
											<Show when={mcpGrants() && mcpGrants()!.length > 0} fallback={<div class="text-muted">none granted</div>}>
												<ul class="mt-1 flex flex-col gap-1">
													<For each={mcpGrants()}>
														{(s) => (
															<li class="flex w-fit items-center gap-1.5 rounded border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-body-muted">
																<span class={"size-1.5 shrink-0 rounded-full " + mcpStateColor(s.state)} title={s.state} />
																{s.name} <span class="text-muted">· {s.toolCount} tools</span>
															</li>
														)}
													</For>
												</ul>
											</Show>
										</div>
									</div>
								</div>
							</div>

							<div class="w-full overflow-x-hidden px-5 pb-5">
								<MemorySection partner={p()!.name} />
							</div>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
