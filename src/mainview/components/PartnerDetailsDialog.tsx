import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { activityWindow } from "../../shared/activity";
import type { SandboxMode, ThinkingLevel } from "../../shared/rpc";
import { renderMarkdown } from "../lib/markdown";
import { mcpStateColor } from "../lib/mcp";
import { rpc } from "../lib/rpc";
import { digits, formatBytes, formatTokens, percent } from "../lib/utils";
import { ActivityHeatmap, HEATMAP_WEEKS } from "./ActivityHeatmap";
import { AnimatedNumber } from "./AnimatedNumber";
import { Button } from "./Button";
import type { PartnerItem } from "./ConversationList";
import { EditorPathButton } from "./EditorPathButton";
import { MemorySection } from "./MemorySection";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuGroupLabel, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const ACTIVITY_WINDOW = `${Math.round(HEATMAP_WEEKS / 4.345)} months`;
const ACTIVITY_WINDOW_SHORT = `${Math.round(HEATMAP_WEEKS / 4.345)}m`;

const seconds = (value: number) => `${(value / 1000).toFixed(1)}s`;
const tokensPerSecond = (value: number) => `${Math.round(value)} tok/s`;

const FACT_LINE = "flex items-baseline justify-between gap-3";
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

const SANDBOX_OPTIONS: { mode: SandboxMode; label: string }[] = [
	{ mode: "read-only", label: "read-only" },
	{ mode: "workspace-write", label: "workspace-write" },
	{ mode: "danger-full-access", label: "full access" },
];

function sandboxLabel(mode: SandboxMode): string {
	return SANDBOX_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

/** A clickable value in a details card: same type and hover as the paths, plus a menu. */
function ValueMenu(props: { label: string; value: string; title: string; children: ReactNode }) {
	return (
		<div className={FACT_LINE}>
			<span className="text-[11px] text-body-muted">{props.label}</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button type="button" className="runtime-value" title={props.title}>
						<span className="truncate">{props.value}</span>
						<ChevronDown size={9} className="runtime-caret" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="max-h-[260px] min-w-40 overflow-y-auto">
					{props.children}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
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
	const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof rpc.request.get_status>> | null>(null);
	const [stats, setStats] = useState<Awaited<ReturnType<typeof rpc.request.stats>> | null>(null);
	const [usage, setUsage] = useState<Awaited<ReturnType<typeof rpc.request.partner_usage>> | null>(null);

	const partnerName = partner?.name ?? null;

	function refreshRuntime() {
		if (!partnerName) return;
		void rpc.request.get_status({ name: partnerName }).then(setRuntime);
		void rpc.request.stats({ name: partnerName }).then(setStats);
	}

	async function mutateModel(next: { provider: string; modelId?: string }) {
		if (!partnerName) return;
		await rpc.request.set_partner_model({ name: partnerName, model: next });
		refreshRuntime();
	}

	async function mutateThinkingLevel(level: ThinkingLevel) {
		if (!partnerName) return;
		await rpc.request.set_thinking_level({ name: partnerName, level });
		refreshRuntime();
	}

	async function mutateSandboxMode(mode: SandboxMode) {
		if (!partnerName) return;
		await rpc.request.set_sandbox_mode({ name: partnerName, mode });
		refreshRuntime();
	}

	useEffect(() => {
		if (!partner) return;
		let cancelled = false;
		const name = partner.name;
		setDays(null);
		setSkills(null);
		setMcpGrants(null);
		setRuntime(null);
		setStats(null);
		setUsage(null);
		void rpc.request.partner_activity({ name, weeks: HEATMAP_WEEKS }).then((res) => !cancelled && setDays(res.days));
		void rpc.request.skill_list({ partner: name }).then((res) => !cancelled && setSkills(res.skills));
		void rpc.request.mcp_partner_grants({ name }).then((res) => !cancelled && setMcpGrants(res.servers));
		void rpc.request.get_status({ name }).then((res) => !cancelled && setRuntime(res));
		void rpc.request.stats({ name }).then((res) => !cancelled && setStats(res));
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

	const heatmapDays = useMemo(() => days ?? activityWindow(HEATMAP_WEEKS), [days]);

	const sessionUsage = stats?.usage ?? null;
	const billed = sessionUsage ? sessionUsage.input + sessionUsage.cacheRead + sessionUsage.cacheWrite : 0;
	const cacheShare = sessionUsage && billed > 0 ? (sessionUsage.cacheRead / billed) * 100 : null;
	const meanTtftMs = stats?.runtime.avgTtftMs ?? stats?.runtime.lastTtftMs ?? null;
	const ttftTitle = meanTtftMs != null ? `mean ${(meanTtftMs / 1000).toFixed(1)}s over ${stats?.runtime.turns ?? 0} turn${stats?.runtime.turns === 1 ? "" : "s"}` : undefined;

	const metricCards = [
		{ label: `Active days · ${ACTIVITY_WINDOW_SHORT}`, value: metrics.activeDays, format: digits, delta: "tokens > 0" },
		{ label: `Turns · ${ACTIVITY_WINDOW_SHORT}`, value: metrics.turns, format: formatTokens, delta: `${formatTokens(metrics.tools)} tools` },
		{ label: `Tokens · ${ACTIVITY_WINDOW_SHORT}`, value: metrics.tokens, format: formatTokens, delta: `last ${ACTIVITY_WINDOW}` },
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
										<div className="font-sans text-[11px] uppercase tracking-[0.1em] text-muted">{card.label}</div>
										<div className="font-mono text-[20px] text-ink leading-tight mt-1">
											<AnimatedNumber value={card.value} format={card.format} />
										</div>
										<div className="font-mono text-[10px] text-seal mt-0.5">{card.delta}</div>
									</div>
								))}
							</div>

							<div className="px-5 pt-2.5">
								<div className={CARD + " p-3"}>
									<p className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Activity · last {ACTIVITY_WINDOW}</p>
									<div className="activity-slot">
										<ActivityHeatmap days={heatmapDays} />
									</div>
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
											<span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Persona</span>
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

								<div className="flex min-w-0 flex-col gap-3">
									<div className={CARD + " p-3 min-w-0"}>
										<p className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">This session</p>
										<div className="grid gap-2 font-sans text-[11px]">
											<div className={FACT_LINE}>
												<span className="text-[11px] text-body-muted">Tokens</span>
												<span
													className={FACT_VALUE}
													title={
														sessionUsage
															? `this session · ${sessionUsage.messages} assistant turns · in ${sessionUsage.input} · out ${sessionUsage.output} · cache read ${sessionUsage.cacheRead} · cache write ${sessionUsage.cacheWrite}`
															: undefined
													}
												>
													{sessionUsage ? (
														<>
															in <AnimatedNumber value={sessionUsage.input} format={formatTokens} /> · out <AnimatedNumber value={sessionUsage.output} format={formatTokens} />
														</>
													) : (
														"—"
													)}
												</span>
											</div>
											<div className={FACT_LINE}>
												<span className="text-[11px] text-body-muted">Cache share</span>
												<span
													className={FACT_VALUE}
													title={cacheShare != null ? `cache read of billed tokens · ${formatTokens(sessionUsage?.cacheRead ?? 0)} of ${formatTokens(billed)}` : undefined}
												>
													{cacheShare != null ? <AnimatedNumber value={cacheShare} format={percent} /> : "—"}
												</span>
											</div>
											<div className={FACT_LINE}>
												<span className="text-[11px] text-body-muted">TTFT</span>
												<span className={FACT_VALUE} title={ttftTitle}>
													{stats?.runtime.lastTtftMs != null ? <AnimatedNumber value={stats.runtime.lastTtftMs} format={seconds} /> : "—"}
												</span>
											</div>
											<div className={FACT_LINE}>
												<span className="text-[11px] text-body-muted">Throughput</span>
												<span className={FACT_VALUE} title="output ÷ generation time · session mean">
													{stats?.runtime.avgTps != null ? <AnimatedNumber value={stats.runtime.avgTps} format={tokensPerSecond} /> : "—"}
												</span>
											</div>
										</div>
									</div>
									<div className={CARD + " p-3 min-w-0"}>
										<p className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-3">Status</p>
										<div className="grid gap-2 font-sans text-[11px]">
											<div>
												<div className="text-[11px] text-body-muted">Workspace</div>
												{runtime?.workspace_path ? (
													<EditorPathButton path={runtime.workspace_path} max={30} class="mt-1 font-mono text-[10.5px]" editors={props.editors} onOpenPath={props.onOpenPath} />
												) : (
													<div className="text-muted">-</div>
												)}
											</div>
											<div>
												<div className="text-[11px] text-body-muted">Storage</div>
												{runtime?.storage_path ? (
													<EditorPathButton path={runtime.storage_path} max={30} class="mt-1 font-mono text-[10.5px]" editors={props.editors} onOpenPath={props.onOpenPath} />
												) : (
													<div className="text-muted">-</div>
												)}
											</div>
											<div className={FACT_LINE}>
												<span className="text-[11px] text-body-muted">Size</span>
												<Tooltip delayDuration={120}>
													<TooltipTrigger asChild>
														<span tabIndex={-1} className={FACT_VALUE}>
															<span className="underline decoration-dotted decoration-ink/30 underline-offset-2">
																{usage ? <AnimatedNumber value={usage.bytes} format={formatBytes} /> : "-"}
															</span>
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
											{runtime && (
												<>
													<ValueMenu
														label="Model"
														value={runtime.model?.modelId ?? "default model"}
														title={runtime.model ? `${runtime.model.provider} · ${runtime.model.modelId ?? "default"}` : "Model"}
													>
														{runtime.models.map((group) => (
															<DropdownMenuGroup key={group.provider}>
																<DropdownMenuGroupLabel className="font-mono text-[10.5px]">{group.provider}</DropdownMenuGroupLabel>
																{group.models.map((model) => (
																	<DropdownMenuItem
																		key={model.id}
																		className="font-mono text-[10.5px] text-ink-soft"
																		onSelect={() => void mutateModel({ provider: group.provider, modelId: model.id })}
																	>
																		{model.name}
																		{model.id === runtime.model?.modelId && <span className="ml-auto text-seal">✓</span>}
																	</DropdownMenuItem>
																))}
															</DropdownMenuGroup>
														))}
													</ValueMenu>
													<ValueMenu label="Effort" value={runtime.thinking_level} title="Effort (thinking level)">
														{runtime.thinking_levels.map((level) => (
															<DropdownMenuItem key={level} className="font-mono text-[10.5px] text-ink-soft" onSelect={() => void mutateThinkingLevel(level)}>
																<span>{level}</span>
																{level === runtime.thinking_level && <span className="ml-auto text-seal">✓</span>}
															</DropdownMenuItem>
														))}
													</ValueMenu>
													<ValueMenu label="Sandbox" value={sandboxLabel(runtime.sandbox_mode)} title="Sandbox mode (file writes)">
														{SANDBOX_OPTIONS.map((option) => (
															<DropdownMenuItem key={option.mode} className="font-mono text-[10.5px] text-ink-soft" onSelect={() => void mutateSandboxMode(option.mode)}>
																<span>{option.label}</span>
																{option.mode === runtime.sandbox_mode && <span className="ml-auto text-seal">✓</span>}
															</DropdownMenuItem>
														))}
													</ValueMenu>
												</>
											)}
											<div>
												<div className="text-[11px] text-body-muted">Skills</div>
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
												<div className="text-[11px] text-body-muted">MCP servers</div>
												{mcpGrants && mcpGrants.length > 0 ? (
													<ul className="mt-1 flex flex-col gap-1">
														{mcpGrants.map((server) => (
															<li
																className="flex w-fit items-center gap-1.5 rounded border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-body-muted"
																key={server.name}
															>
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
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
