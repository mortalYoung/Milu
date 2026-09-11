import { createMemo, createResource, For, Show } from "solid-js";
import { renderMarkdown } from "../lib/markdown";
import { mcpStateColor } from "../lib/mcp";
import { rpc } from "../lib/rpc";
import { formatTokens } from "../lib/utils";
import { ActivityHeatmap, HEATMAP_WEEKS } from "./ActivityHeatmap";
import type { PartnerItem } from "./ConversationList";
import { MemorySection } from "./MemorySection";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function formatDate(ts: number): string {
	const d = new Date(ts);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function shortPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.slice(-2).join("/");
}

function avatarInitial(name: string): string {
	const trimmed = name.trim();
	return trimmed ? trimmed[0].toUpperCase() : "?";
}

export function PartnerDetailsDialog(props: { partner: PartnerItem | null; onOpenChange: (open: boolean) => void }) {
	const p = () => props.partner;

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
		{ label: "Active days · 12w", value: String(metrics().activeDays), delta: "tokens > 0" },
		{ label: "Turns · 12w", value: formatTokens(metrics().turns), delta: `${formatTokens(metrics().tools)} tools` },
		{ label: "Tokens · 12w", value: formatTokens(metrics().tokens), delta: "last 12 weeks" },
	];

	return (
		<Dialog open={p() != null} onOpenChange={props.onOpenChange}>
			<DialogContent class="w-[820px] max-w-[820px] bg-paper text-ink p-0 gap-0 overflow-hidden">
				<DialogTitle class="sr-only">{p()?.name ?? ""}</DialogTitle>
				{p() && (
					<div class="flex max-h-[min(86vh,900px)] flex-col overflow-y-auto">
						<div class="flex items-center gap-3 px-5 pt-4 pb-3 pr-12">
							<div class="size-10 rounded-md bg-ink text-paper flex items-center justify-center font-sans text-[18px] font-bold">{avatarInitial(p()!.name)}</div>
							<div class="min-w-0">
								<h2 class="font-sans text-[16px] font-semibold text-ink leading-tight">{p()!.name}</h2>
								<p class="font-sans text-[11px] text-body-muted truncate">
									{shortPath(p()!.path)} · created {formatDate(p()!.createdAt)}
								</p>
							</div>
							<Show when={p()!.writing}>
								<span class="ml-auto font-sans text-[10px] font-medium text-seal border border-seal/30 bg-seal-soft rounded-[5px] px-2 py-1">● writing</span>
							</Show>
						</div>

						<div class="grid grid-cols-3 gap-2.5 px-5">
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
							<div class="border border-hairline bg-letter rounded-md p-3 min-w-0">
								<p class="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Persona</p>
								{p()!.persona?.trim() ? (
									<div class="md font-sans text-[12.5px] leading-[1.65] text-ink" innerHTML={renderMarkdown(p()!.persona!)} />
								) : (
									<p class="font-sans text-[12.5px] text-muted">-</p>
								)}

								<Show when={days()}>
									<p class="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mt-4 mb-2">Activity · last 12 weeks</p>
									<ActivityHeatmap days={days()!} />
								</Show>
							</div>

							<div class="border border-hairline bg-letter rounded-md p-3 min-w-0">
								<p class="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Status</p>
								<div class="grid gap-2 font-sans text-[11px]">
									<div>
										<div class="text-body-muted">Directory</div>
										<div class="text-ink font-mono text-[10.5px] break-all">{shortPath(p()!.path)}</div>
									</div>
									<div>
										<div class="text-body-muted">Created</div>
										<div class="text-ink font-mono text-[10.5px]">{formatDate(p()!.createdAt)}</div>
									</div>
									<div>
										<div class="text-body-muted">Workspace</div>
										<div class="text-ink font-mono text-[10.5px] break-all">{runtime()?.workspace_path ?? "-"}</div>
									</div>
									<div>
										<div class="text-body-muted">Storage</div>
										<div class="text-ink font-mono text-[10.5px] break-all">{runtime()?.storage_path ?? "-"}</div>
									</div>
									<div>
										<div class="text-body-muted">Model</div>
										<div class="text-ink font-mono text-[10.5px] break-all">
											{runtime()?.model ? [runtime()!.model!.provider, runtime()!.model!.modelId ?? "default"].join(" · ") : "default model"}
										</div>
									</div>
									<div>
										<div class="text-body-muted">Effort</div>
										<div class="text-ink font-mono text-[10.5px]">{runtime()?.thinking_level ?? "-"}</div>
									</div>
									<div>
										<div class="text-body-muted">Sandbox</div>
										<div class="text-ink font-mono text-[10.5px] break-all">{runtime()?.sandbox_mode ?? "-"}</div>
									</div>
									<div>
										<div class="text-body-muted">Skills</div>
										<Show when={skills() && skills()!.length > 0} fallback={<div class="text-muted">none granted</div>}>
											<ul class="mt-1 flex flex-col gap-1">
												<For each={skills()}>
													{(s) => (
														<li class="font-mono text-[10.5px] text-body-muted border border-hairline rounded px-1.5 py-0.5 w-fit">
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

						<div class="px-5 pb-5">
							<MemorySection partner={p()!.name} />
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
