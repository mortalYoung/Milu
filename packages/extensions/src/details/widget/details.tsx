import { type DialogProps, formatWorkspacePath, tildifyPath } from "@milu/window/api";
import { Markdown } from "@milu/window/api/markdown/react";
import { Tip } from "@milu/window/api/tooltip";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, ChevronRight, FolderPen, Lock, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { MODEL_PANEL, ModelPanel, ModelPill, modelRowsOf } from "../../models/picker.tsx";
import { CARD, EYEBROW, HEAD_ROW, MENU, MENU_ITEM, SUMMARY } from "../chrome.ts";
import type { SessionDetails, SessionSummary } from "../index.ts";
import { digits, formatBytes, formatDate, formatSize, formatTokens, percent, seconds, tokensPerSecond } from "../utils.ts";
import { ActivityHeatmap } from "./activity.tsx";
import { AnimatedNumber } from "./animated-number.tsx";
import { MemorySection } from "./memory.tsx";
import { ScheduleSection } from "./schedule.tsx";
import { LoadingLines } from "./skeleton.tsx";

const DOT: Readonly<Record<string, string>> = { connected: "bg-accent-teal", connecting: "bg-accent-amber", error: "bg-signal" };

function Chevron(props: { open: boolean }) {
	return props.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />;
}

function Fact(props: { label: string; tip?: string; block?: boolean; children: ReactNode }) {
	const value = (
		<span className={props.block ? "w-full whitespace-normal text-left font-mono text-[12px] text-ink" : "min-w-0 truncate text-right font-mono text-[12px] text-ink"}>
			{props.children}
		</span>
	);
	return (
		<div className={props.block ? "flex min-w-0 flex-col gap-1" : "flex min-w-0 items-baseline justify-between gap-3"}>
			<span className="shrink-0 text-[12px] text-muted">{props.label}</span>
			{props.tip ? <Tip label={props.tip}>{value}</Tip> : value}
		</div>
	);
}

function MenuValue(props: { label: string; value: string; tip?: string; icon?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-baseline justify-between gap-3">
			<span className="shrink-0 text-[12px] text-muted">{props.label}</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<button
						type="button"
						className="inline-flex min-w-0 cursor-pointer items-center gap-[3px] border-0 bg-transparent p-0 font-mono text-[12px] text-ink"
						aria-label={`${props.label}: ${props.tip ?? props.value}`}
					>
						<Tip label={props.tip}>
							<span className="inline-flex min-w-0 items-center gap-[4px] [&>span:first-child]:overflow-hidden [&>span:first-child]:text-ellipsis [&>span:first-child]:whitespace-nowrap">
								{props.icon}
								<span>{props.value}</span>
								<ChevronDown size={9} className="shrink-0 text-muted-soft" />
							</span>
						</Tip>
					</button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content className={MENU} align="end" sideOffset={4} collisionPadding={8}>
						{props.children}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>
	);
}

const SANDBOX_OPTIONS = [
	{ mode: "read-only", label: "read-only", icon: Lock, danger: false },
	{ mode: "workspace-write", label: "workspace-write", icon: FolderPen, danger: false },
	{ mode: "danger-full-access", label: "full access", icon: TriangleAlert, danger: true },
] as const;

function EffortBars(props: { level: string; levels: readonly string[] }) {
	const total = Math.max(props.levels.length, 1);
	const filled = Math.max(props.levels.indexOf(props.level) + 1, 1);
	return (
		<span className="inline-flex w-[14px] shrink-0 items-end justify-center gap-[2px]" aria-hidden>
			{Array.from({ length: total }, (_, index) => (
				<span key={index} className={`w-[2px] rounded-[1px] ${index < filled ? "bg-ink" : "bg-line-strong"}`} style={{ height: `${4 + index * 2}px` }} />
			))}
		</span>
	);
}

function SandboxIcon(props: { mode: string; size?: number }) {
	const option = SANDBOX_OPTIONS.find((each) => each.mode === props.mode);
	if (!option) return null;
	const Icon = option.icon;
	return (
		<span className="inline-flex w-[14px] shrink-0 justify-center">
			<Icon size={props.size ?? 12} className={option.danger ? "text-signal" : "text-ink-soft"} />
		</span>
	);
}

function sandboxLabel(mode: string): string {
	return SANDBOX_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

export function SessionDetailsDialog(props: DialogProps) {
	const [personaOpen, setPersonaOpen] = useState(true);
	const summary = props.data as SessionSummary | null;
	const [details, setDetails] = useState<SessionDetails | null>(null);
	const [error, setError] = useState<string | null>(null);

	const name = summary?.name;
	const refresh = useCallback(async () => {
		if (!name) return;
		try {
			const next = await props.host.actions.request<SessionDetails>("details.collect", name);
			if (next) setDetails(next);
			setError(null);
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		}
	}, [name, props.host]);

	useEffect(() => {
		if (!name) return;
		let cancelled = false;
		void props.host.actions
			.request<SessionDetails>("details.collect", name)
			.then((next) => {
				if (!cancelled && next) setDetails(next);
			})
			.catch((loadError: unknown) => {
				if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
			});
		return () => {
			cancelled = true;
		};
	}, [name, props.host]);

	if (!summary) return null;

	const shown = details ?? summary;
	const initial = shown.name.trim().charAt(0).toUpperCase() || "?";
	const personaLine = shown.persona?.trim().split("\n")[0] || "not set";
	const days = details?.activity ?? [];
	const activeDays = days.filter((day) => day.tokens > 0).length;
	const turns = days.reduce((sum, day) => sum + day.turns, 0);
	const tokens = days.reduce((sum, day) => sum + day.tokens, 0);
	const tools = days.reduce((sum, day) => sum + day.tools, 0);
	const pending = !details && !error;
	const cards = [
		{ label: "Active days · 12m", value: <AnimatedNumber value={details ? activeDays : 0} format={digits} />, hint: "tokens > 0" },
		{ label: "Turns · 12m", value: <AnimatedNumber value={details ? turns : 0} format={formatTokens} />, hint: `${formatTokens(details ? tools : 0)} tools` },
		{ label: "Tokens · 12m", value: <AnimatedNumber value={details ? tokens : 0} format={formatTokens} />, hint: "last 12 months" },
	];
	const usage = details?.usage ?? null;
	const sizeParts = details?.size.parts.map((part) => `${part.label} · ${formatBytes(part.bytes)}`).join("\n");
	const modelLabel = details?.model?.name ?? details?.resolved?.name ?? (details ? "default" : "—");
	const sandbox = details ? sandboxLabel(details.sandbox) : "—";
	const external = shown.origin != null;

	async function setModel(provider: string, modelId?: string): Promise<void> {
		await props.host.actions.invoke("model.set", summary?.name, { provider, ...(modelId ? { modelId } : {}) });
		await refresh();
	}

	async function setEffort(level: string): Promise<void> {
		await props.host.actions.invoke("model.effort", summary?.name, { level });
		await refresh();
	}

	async function setSandbox(mode: string): Promise<void> {
		await props.host.actions.invoke("permission.sandbox", summary?.name, { mode });
		await refresh();
	}

	return (
		<div className="flex h-[min(720px,86vh)] w-[min(820px,calc(100vw-48px))] flex-col overflow-hidden font-sans text-ink">
			<header className="flex shrink-0 items-center gap-3 border-b border-line px-5 pt-4 pb-3 pr-12">
				<span className="grid size-10 place-items-center rounded-md bg-ink text-[18px] font-bold leading-none text-canvas">{initial}</span>
				<div className="min-w-0">
					<h2 className="m-0 text-[16px] font-semibold leading-tight text-ink">{shown.name}</h2>
					<p className="m-0 mt-0.5 truncate text-[12px] text-muted">
						{shown.path} · created {formatDate(shown.createdAt)}
					</p>
				</div>
				{shown.running ? <span className="ml-auto rounded-md border border-line bg-hover px-2 py-1 text-[10px] font-medium text-ink">● writing</span> : null}
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pt-2.5 pb-5">
				{error ? <p className="mb-2.5 rounded-md border-[0.5px] border-[color-mix(in_srgb,var(--signal)_40%,transparent)] px-2.5 py-2 text-[12px] text-signal">{error}</p> : null}

				<div className="grid grid-cols-3 gap-2.5">
					{cards.map((card) => (
						<div className="flex flex-col rounded-md border border-line bg-surface px-3 py-2.5" key={card.label}>
							<span className={EYEBROW}>{card.label}</span>
							<span className="mt-1 font-mono text-[18px] leading-tight text-ink">{card.value}</span>
							<span className="mt-0.5 font-mono text-[10px] text-muted">{card.hint}</span>
						</div>
					))}
				</div>

				<div className="mt-2.5 rounded-md border border-line bg-surface p-3">
					<p className={EYEBROW}>Activity · last 12 months</p>
					{error ? <p className="text-[11px] text-muted">—</p> : <ActivityHeatmap days={details?.activity ?? []} loading={!details} />}
				</div>

				<div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_240px] gap-2.5">
					<div className="flex min-w-0 flex-col gap-2.5">
						<section className={CARD}>
							<button type="button" className={HEAD_ROW} aria-expanded={personaOpen} onClick={() => setPersonaOpen(!personaOpen)}>
								<span className={EYEBROW}>Persona</span>
								<span className={SUMMARY}>{personaLine}</span>
								<Chevron open={personaOpen} />
							</button>
							{personaOpen ? (
								<div className="px-3 pb-3 [&_p]:m-0 [&_p]:text-[13px] [&_p]:leading-[1.65] [&_p]:whitespace-pre-wrap [&_p]:text-ink [&_p]:[overflow-wrap:anywhere]">
									{shown.persona?.trim() ? (
										<Markdown port={props.host.markdown} text={shown.persona} />
									) : (
										<>
											<p>No persona on file</p>
											<p className="mt-1 leading-[1.6] text-muted">
												A hand-written paragraph in <code className="font-mono text-[12px]">profile.json</code>, read as this session's standing instructions.
											</p>
										</>
									)}
								</div>
							) : null}
						</section>

						<MemorySection memory={details?.memory ?? null} loading={!details && !error} onOpen={() => void props.host.actions.invoke("memory.open", shown.name)} />
						<ScheduleSection data={details?.schedules ?? null} sandbox={sandbox} loading={!details && !error} />
					</div>

					<div className="flex min-w-0 flex-col gap-3">
						<section className="rounded-md border border-line bg-surface p-3">
							<p className={EYEBROW}>This Session</p>
							<div className="mt-2 grid gap-2 text-[12px]">
								<Fact
									label="Tokens"
									tip={
										usage
											? `${usage.messages} assistant turns · in ${usage.input} · out ${usage.output} · cache read ${usage.cacheRead} · cache write ${usage.cacheWrite}`
											: "no turns in this session yet"
									}
								>
									{details && !usage ? (
										"—"
									) : (
										<>
											in <AnimatedNumber value={usage?.input ?? 0} format={formatTokens} /> · out <AnimatedNumber value={usage?.output ?? 0} format={formatTokens} />
										</>
									)}
								</Fact>
								<Fact
									label="Cache Share"
									tip={usage ? `cache read of billed tokens · ${formatTokens(usage.cacheRead)} of ${formatTokens(usage.input + usage.cacheRead + usage.cacheWrite)}` : undefined}
								>
									{details && details.cacheShare == null ? "—" : <AnimatedNumber value={details?.cacheShare ?? 0} format={percent} />}
								</Fact>
								<Fact
									label="TTFT"
									tip={details?.runtime && details.runtime.turns > 0 ? `mean ${seconds(details.runtime.avgTtftMs ?? 0)} over ${details.runtime.turns} turns` : undefined}
								>
									{details && details.runtime?.lastTtftMs == null ? "—" : <AnimatedNumber value={details?.runtime?.lastTtftMs ?? 0} format={seconds} />}
								</Fact>
								<Fact label="Throughput" tip="output ÷ generation time · session mean">
									{details && details.runtime?.avgTps == null ? "—" : <AnimatedNumber value={details?.runtime?.avgTps ?? 0} format={tokensPerSecond} />}
								</Fact>
								<Fact label="Context" tip="last request's context window usage">
									{details && !details.context ? (
										"—"
									) : (
										<>
											<AnimatedNumber value={details?.context?.percent ?? 0} format={(value) => `${Math.round(value)}%`} /> ·{" "}
											<AnimatedNumber value={details?.context?.used ?? 0} format={formatTokens} /> / <AnimatedNumber value={details?.context?.window ?? 0} format={formatTokens} />
										</>
									)}
								</Fact>
							</div>
						</section>

						<section className="rounded-md border border-line bg-surface p-3">
							<p className={EYEBROW}>Status</p>
							<div className="mt-2 grid gap-2 text-[12px]">
								<Fact label="Workspace" block tip={shown.workspace?.path ? tildifyPath(shown.workspace.path) : undefined}>
									{shown.workspace?.path ? formatWorkspacePath(shown.workspace.path, 34) : "—"}
								</Fact>
								<Fact label="Storage" block tip={tildifyPath(shown.storage)}>
									{shown.storage}
								</Fact>
								{shown.origin ? (
									<Fact label="Origin" tip={`created by ${shown.origin}`}>
										{shown.origin}
									</Fact>
								) : null}
								<Fact label="Size" tip={sizeParts}>
									<AnimatedNumber value={details?.size.bytes ?? 0} format={formatSize} />
								</Fact>
								{details?.models.length && !external ? (
									<div className="flex min-w-0 items-center justify-between gap-3">
										<span className="shrink-0 text-[12px] text-muted">Model</span>
										<Popover.Root>
											<Popover.Trigger asChild>
												<ModelPill
													provider={details.model?.provider ?? details.resolved?.provider ?? null}
													label={modelLabel}
													aria-label={`Model: ${modelLabel}`}
													title={
														details.model
															? `${details.model.provider} · ${details.model.name ?? "default"}`
															: `default · ${details.resolved?.provider ?? "—"} · ${details.resolved?.name ?? "—"}`
													}
												/>
											</Popover.Trigger>
											<Popover.Portal>
												<Popover.Content side="bottom" align="end" sideOffset={6} collisionPadding={8} className={MODEL_PANEL} onOpenAutoFocus={(event) => event.preventDefault()}>
													<ModelPanel rows={modelRowsOf(details.models)} selected={details.model} onPick={(row) => void setModel(row.provider, row.id)} />
												</Popover.Content>
											</Popover.Portal>
										</Popover.Root>
									</div>
								) : (
									<Fact label="Model">{details ? modelLabel : "—"}</Fact>
								)}
								{details?.efforts.length && !external ? (
									<MenuValue label="Effort" value={details.effort} tip="Effort (Thinking Level)" icon={<EffortBars level={details.effort} levels={details.efforts} />}>
										{details.efforts.map((level) => (
											<DropdownMenu.Item
												className={`${MENU_ITEM} ${level === details.effort ? "text-ink" : ""}`}
												key={level}
												style={level === details.effort ? { backgroundColor: "var(--selected)" } : undefined}
												onSelect={() => void setEffort(level)}
											>
												<EffortBars level={level} levels={details.efforts} />
												<span>{level}</span>
											</DropdownMenu.Item>
										))}
									</MenuValue>
								) : (
									<Fact label="Effort">{details ? (details.effort ?? "—") : "—"}</Fact>
								)}
								{details && !external ? (
									<MenuValue label="Sandbox" value={sandbox} tip="default permission for new runs (global)" icon={<SandboxIcon mode={details.sandbox} />}>
										{SANDBOX_OPTIONS.map((option) => (
											<DropdownMenu.Item
												className={`${MENU_ITEM} ${option.mode === details.sandbox ? "text-ink" : ""}`}
												key={option.mode}
												style={option.mode === details.sandbox ? { backgroundColor: "var(--selected)" } : undefined}
												onSelect={() => void setSandbox(option.mode)}
											>
												<SandboxIcon mode={option.mode} />
												<span className={option.danger ? "text-signal" : undefined}>{option.label}</span>
											</DropdownMenu.Item>
										))}
									</MenuValue>
								) : (
									<Fact label="Sandbox" tip="default permission for new runs (global)">
										{details ? sandbox : "—"}
									</Fact>
								)}
								<Fact label="Skills" block>
									{details ? (
										details.skills.length > 0 ? (
											<ul className="m-0 flex list-none flex-col gap-1 p-0 [&>li]:rounded-md [&>li]:border-[0.5px] [&>li]:border-line [&>li]:px-1.5 [&>li]:py-[1px] [&>li]:font-mono [&>li]:text-[11px] [&>li]:text-ink-soft [&>li]:[overflow-wrap:anywhere]">
												{details.skills.map((skill) => (
													<li key={skill.name}>
														{skill.name} <span className="text-muted">· {skill.scope}</span>
													</li>
												))}
											</ul>
										) : (
											<span className="text-[11px] text-muted">none granted</span>
										)
									) : pending ? (
										<LoadingLines rows={2} />
									) : (
										"—"
									)}
								</Fact>
								<Fact label="MCP Servers" block>
									{details ? (
										details.mcp.length > 0 ? (
											<ul className="m-0 flex list-none flex-col gap-1 p-0 [&>li]:rounded-md [&>li]:border-[0.5px] [&>li]:border-line [&>li]:px-1.5 [&>li]:py-[1px] [&>li]:font-mono [&>li]:text-[11px] [&>li]:text-ink-soft [&>li]:[overflow-wrap:anywhere]">
												{details.mcp.map((server) => (
													<li key={server.name}>
														<Tip label={server.state}>
															<span className={`inline-block size-1.5 rounded-full ${DOT[server.state] ?? "bg-muted-soft"}`} />
														</Tip>{" "}
														{server.name} <span className="text-muted">· {server.toolCount} tools</span>
													</li>
												))}
											</ul>
										) : (
											<span className="text-[11px] text-muted">none granted</span>
										)
									) : pending ? (
										<LoadingLines rows={2} />
									) : (
										"—"
									)}
								</Fact>
								{details ? (
									<>
										<Fact label="Fork of">{details.forkedFrom ?? "—"}</Fact>
										<Fact label="Pinned">{details.pinned ? "yes" : "no"}</Fact>
									</>
								) : null}
							</div>
						</section>
					</div>
				</div>
			</div>
		</div>
	);
}

export default SessionDetailsDialog;
