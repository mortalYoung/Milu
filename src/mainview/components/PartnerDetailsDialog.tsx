import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

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
	return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

export function PartnerDetailsDialog(props: {
	partner: PartnerItem | null;
	onOpenChange: (open: boolean) => void;
	onOpenPath?: (path: string, editorId?: string) => void;
	editors?: { id: string; name: string }[];
}) {
	const partner = props.partner;
	const [personaOpen, setPersonaOpen] = useState(false);
	const [days, setDays] = useState<Awaited<ReturnType<typeof rpc.request.partner_activity>>["days"] | null>(null);
	const [skills, setSkills] = useState<Awaited<ReturnType<typeof rpc.request.skill_list>>["skills"] | null>(null);
	const [mcpGrants, setMcpGrants] = useState<Awaited<ReturnType<typeof rpc.request.mcp_partner_grants>>["servers"] | null>(null);
	const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof rpc.request.partner_runtime>> | null>(null);
	const [usage, setUsage] = useState<Awaited<ReturnType<typeof rpc.request.partner_usage>> | null>(null);

	useEffect(() => {
		if (!partner) return;
		let cancelled = false;
		const name = partner.name;
		setDays(null);
		setSkills(null);
		setMcpGrants(null);
		setRuntime(null);
		setUsage(null);
		void rpc.request.partner_activity({ name, weeks: HEATMAP_WEEKS }).then((res) => !cancelled && setDays(res.days));
		void rpc.request.skill_list({ partner: name }).then((res) => !cancelled && setSkills(res.skills));
		void rpc.request.mcp_partner_grants({ name }).then((res) => !cancelled && setMcpGrants(res.servers));
		void rpc.request.partner_runtime({ name }).then((res) => !cancelled && setRuntime(res));
		void rpc.request.partner_usage({ name }).then((res) => !cancelled && setUsage(res));
		return () => {
			cancelled = true;
		};
	}, [partner]);

	const personaLine = partner?.persona?.trim().split("\n")[0] || "not set";

	const metrics = useMemo(() => {
		const list = days ?? [];
		return {
			activeDays: list.filter((day) => day.tokens > 0).length,
			turns: list.reduce((sum, day) => sum + day.turns, 0),
			tools: list.reduce((sum, day) => sum + day.tools, 0),
			tokens: list.reduce((sum, day) => sum + day.tokens, 0),
		};
	}, [days]);

	const metricCards = [
		{ label: `Active days · ${ACTIVITY_WINDOW_SHORT}`, value: String(metrics.activeDays), delta: "tokens > 0" },
		{ label: `Turns · ${ACTIVITY_WINDOW_SHORT}`, value: formatTokens(metrics.turns), delta: `${formatTokens(metrics.tools)} tools` },
		{ label: `Tokens · ${ACTIVITY_WINDOW_SHORT}`, value: formatTokens(metrics.tokens), delta: `last ${ACTIVITY_WINDOW}` },
	];

	return (
		<Dialog open={partner != null} onOpenChange={props.onOpenChange}>
			<DialogContent focusClose className="w-[820px] max-w-[820px] bg-paper text-ink p-0 gap-0 overflow-hidden">
				<DialogTitle className="sr-only">{partner?.name ?? ""}</DialogTitle>
				{partner && (
					<div className="flex w-full max-h-[min(86vh,900px)] flex-col overflow-x-hidden">
						<div className="flex shrink-0 items-center gap-3 border-b border-hairline px-5 pt-4 pb-3 pr-12">
							<div className="size-10 rounded-md bg-ink text-paper flex items-center justify-center font-sans text-[18px] font-bold">{avatarInitial(partner.name)}</div>
							<div className="min-w-0">
								<h2 className="font-sans text-[16px] font-semibold text-ink leading-tight">{partner.name}</h2>
								<p className="font-sans text-[11px] text-body-muted truncate" title={partner.path}>
									{partner.path} · created {formatDate(partner.createdAt)}
								</p>
							</div>
							{partner.writing && <span className="ml-auto font-sans text-[10px] font-medium text-seal border border-seal/30 bg-seal-soft rounded-[5px] px-2 py-1">● writing</span>}
						</div>

						<div className="w-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
							<div className="grid grid-cols-3 gap-2.5 px-5 pt-2.5">
								{metricCards.map((card) => (
									<div className="border border-hairline bg-letter rounded-md px-3 py-2.5" key={card.label}>
										<div className="font-sans text-[9.5px] uppercase tracking-[0.1em] text-muted">{card.label}</div>
										<div className="font-mono text-[20px] text-ink leading-tight mt-1">{card.value}</div>
										<div className="font-mono text-[10px] text-seal mt-0.5">{card.delta}</div>
									</div>
								))}
							</div>

							<div className="px-5 pt-2.5">
								<div className={CARD + " p-3"}>
									<p className="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Activity · last {ACTIVITY_WINDOW}</p>
									<div className="activity-slot">{days && <ActivityHeatmap days={days} />}</div>
								</div>
							</div>

							<div className="grid grid-cols-[1fr_240px] gap-2.5 px-5 pt-2.5 pb-5">
								<div className="flex min-w-0 flex-col gap-2.5">
									<div className={CARD}>
										<button
											type="button"
											className="card-head flex w-full items-center gap-2 rounded-t-[5px] px-3 py-2.5 text-left"
											aria-expanded={personaOpen}
											onClick={() => setPersonaOpen(!personaOpen)}
										>
											<span className="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">Persona</span>
											<span className="min-w-0 flex-1 truncate font-sans text-[11px] text-body-muted">{personaLine}</span>
											{personaOpen ? <ChevronDown size={14} className="shrink-0 text-muted" /> : <ChevronRight size={14} className="shrink-0 text-muted" />}
										</button>
										{personaOpen && (
											<div className="px-3 pb-3">
												{partner.persona?.trim() ? (
													<div className="md font-sans text-[12.5px] leading-[1.65] text-ink" dangerouslySetInnerHTML={{ __html: renderMarkdown(partner.persona) }} />
												) : (
													<div className="min-w-0">
														<p className="font-sans text-[12.5px] text-ink">No persona on file</p>
														<p className="mt-1 font-sans text-[12px] leading-[1.6] text-muted">
															A hand-written paragraph in <span className="font-mono text-[11px]">profile.json</span>, read as the partner's standing instructions.
														</p>
														<Button variant="link" size="sm" class="mt-1 -ml-3 [&_svg]:size-3" onClick={() => props.onOpenPath?.(partner.path)}>
															Open partner folder <ExternalLink />
														</Button>
													</div>
												)}
											</div>
										)}
									</div>

									<MemorySection partner={partner.name} />
								</div>

								<div className={CARD + " p-3 min-w-0 self-start"}>
									<p className="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Status</p>
									<div className="grid gap-2 font-sans text-[11px]">
										<div>
											<div className="text-body-muted">Workspace</div>
											{runtime?.workspace_path ? (
												<EditorPathButton path={runtime.workspace_path} max={30} class="font-mono text-[10.5px]" editors={props.editors} onOpenPath={props.onOpenPath} />
											) : (
												<div className="text-muted">-</div>
											)}
										</div>
										<div>
											<div className="text-body-muted">Storage</div>
											{runtime?.storage_path ? (
												<EditorPathButton path={runtime.storage_path} max={30} class="font-mono text-[10.5px]" editors={props.editors} onOpenPath={props.onOpenPath} />
											) : (
												<div className="text-muted">-</div>
											)}
										</div>
										<div className={FACT_LINE}>
											<span className="text-body-muted">Size</span>
											<Tooltip delayDuration={120}>
												<TooltipTrigger asChild>
													<span tabIndex={-1} className={FACT_VALUE}>
														<span className="underline decoration-dotted decoration-ink/30 underline-offset-2">{usage ? formatBytes(usage.bytes) : "-"}</span>
													</span>
												</TooltipTrigger>
												<TooltipContent side="top" className="leading-snug">
													{usage?.parts.length ? (
														<ul className="flex flex-col gap-0.5">
															{usage.parts.map((part) => (
																<li className="flex items-baseline gap-2" key={part.label}>
																	<span className="min-w-[62px] text-paper/70">{part.label}</span>
																	<span className="font-mono tabular-nums">{formatBytes(part.bytes)}</span>
																</li>
															))}
														</ul>
													) : (
														"no files yet"
													)}
												</TooltipContent>
											</Tooltip>
										</div>
										<div className={FACT_LINE}>
											<span className="text-body-muted">Model</span>
											<span className={FACT_VALUE} title={runtime?.model ? `${runtime.model.provider} · ${runtime.model.modelId ?? "default"}` : undefined}>
												{runtime?.model?.modelId ?? "default"}
											</span>
										</div>
										<div className={FACT_LINE}>
											<span className="text-body-muted">Effort</span>
											<span className={FACT_VALUE}>{runtime?.thinking_level ?? "-"}</span>
										</div>
										<div className={FACT_LINE}>
											<span className="text-body-muted">Sandbox</span>
											<span className={FACT_VALUE}>{runtime?.sandbox_mode ?? "-"}</span>
										</div>
										<div>
											<div className="text-body-muted">Skills</div>
											{skills && skills.length > 0 ? (
												<ul className="mt-1 flex flex-col gap-1">
													{skills.map((skill) => (
														<li className="w-fit rounded border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-body-muted" key={skill.name}>
															{skill.name} <span className="text-muted">· {skill.scope}</span>
														</li>
													))}
												</ul>
											) : (
												<div className="text-muted">none granted</div>
											)}
										</div>
										<div>
											<div className="text-body-muted">MCP servers</div>
											{mcpGrants && mcpGrants.length > 0 ? (
												<ul className="mt-1 flex flex-col gap-1">
													{mcpGrants.map((server) => (
														<li className="flex w-fit items-center gap-1.5 rounded border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-body-muted" key={server.name}>
															<span className={"size-1.5 shrink-0 rounded-full " + mcpStateColor(server.state)} title={server.state} />
															{server.name} <span className="text-muted">· {server.toolCount} tools</span>
														</li>
													))}
												</ul>
											) : (
												<div className="text-muted">none granted</div>
											)}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
