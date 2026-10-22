import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { type DialogProps, formatWorkspacePath, tildifyPath } from "../host/index.ts";
import { Tip } from "../host/tooltip.tsx";
import { Markdown } from "../markdown/react.tsx";
import { ActivityHeatmap } from "./activity.tsx";
import { AnimatedNumber } from "./animated-number.tsx";
import type { ModelChoiceGroup, SessionDetails, SessionSummary } from "./details.ts";
import { MemorySection } from "./memory.tsx";
import { ScheduleSection } from "./schedule.tsx";
import { LoadingLines } from "./skeleton.tsx";
import { digits, formatBytes, formatDate, formatSize, formatTokens, percent, seconds, tokensPerSecond } from "./utils.ts";

import "./details.css";

function Chevron(props: { open: boolean }) {
	return props.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />;
}

function Fact(props: { label: string; tip?: string; block?: boolean; children: ReactNode }) {
	const value = <span className="ext-details-fact-value">{props.children}</span>;
	return (
		<div className={props.block ? "ext-details-fact is-block" : "ext-details-fact"}>
			<span className="ext-details-fact-label">{props.label}</span>
			{props.tip ? <Tip label={props.tip}>{value}</Tip> : value}
		</div>
	);
}

function MenuValue(props: { label: string; value: string; tip?: string; children: ReactNode }) {
	return (
		<div className="ext-details-fact">
			<span className="ext-details-fact-label">{props.label}</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<button type="button" className="ext-details-menu-value" aria-label={`${props.label}: ${props.tip ?? props.value}`}>
						<Tip label={props.tip}>
							<span className="ext-details-menu-text">
								<span>{props.value}</span>
								<ChevronDown size={9} />
							</span>
						</Tip>
					</button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content className="ext-details-menu" align="end" sideOffset={4} collisionPadding={8}>
						{props.children}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>
	);
}

function ModelMenu(props: { groups: readonly ModelChoiceGroup[]; model: { provider: string; modelId?: string } | null; onSelect: (provider: string, modelId?: string) => void }) {
	return (
		<>
			{props.groups.map((group) => (
				<DropdownMenu.Group key={group.provider}>
					<DropdownMenu.Label className="ext-details-menu-label">{group.provider}</DropdownMenu.Label>
					{group.models.map((model) => (
						<DropdownMenu.Item className="ext-details-menu-item" key={model.id} onSelect={() => props.onSelect(group.provider, model.id)}>
							<span>{model.name}</span>
							{props.model?.provider === group.provider && props.model.modelId === model.id ? <span className="ext-details-menu-check">✓</span> : null}
						</DropdownMenu.Item>
					))}
				</DropdownMenu.Group>
			))}
		</>
	);
}

const SANDBOX_OPTIONS = [
	{ mode: "read-only", label: "read-only" },
	{ mode: "workspace-write", label: "workspace-write" },
	{ mode: "danger-full-access", label: "full access" },
] as const;

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
	const modelLabel = details?.model?.modelId ?? (details ? "default" : "—");
	const sandbox = details ? sandboxLabel(details.sandbox) : "—";

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
		<div className="ext-details">
			<header className="ext-details-head">
				<span className="ext-details-avatar">{initial}</span>
				<div className="ext-details-ident">
					<h2>{shown.name}</h2>
					<p>
						{shown.path} · created {formatDate(shown.createdAt)}
					</p>
				</div>
				{shown.running ? <span className="ext-details-writing">● writing</span> : null}
			</header>

			<div className="ext-details-body">
				{error ? <p className="ext-details-error">{error}</p> : null}

				<div className="ext-details-cards">
					{cards.map((card) => (
						<div className="ext-details-card ext-details-metric" key={card.label}>
							<span className="ext-details-caption">{card.label}</span>
							<span className="ext-details-number">{card.value}</span>
							<span className="ext-details-hint">{card.hint}</span>
						</div>
					))}
				</div>

				<div className="ext-details-card ext-details-activity">
					<p className="ext-details-caption">Activity · last 12 months</p>
					{error ? <p className="ext-details-muted">—</p> : <ActivityHeatmap days={details?.activity ?? []} loading={!details} />}
				</div>

				<div className="ext-details-grid">
					<div className="ext-details-column">
						<section className="ext-details-card">
							<button type="button" className="ext-details-head-row" aria-expanded={personaOpen} onClick={() => setPersonaOpen(!personaOpen)}>
								<span className="ext-details-caption">Persona</span>
								<span className="ext-details-summary">{personaLine}</span>
								<Chevron open={personaOpen} />
							</button>
							{personaOpen ? (
								<div className="ext-details-persona">
									{shown.persona?.trim() ? (
										<Markdown port={props.host.markdown} text={shown.persona} />
									) : (
										<>
											<p>No persona on file</p>
											<p className="ext-details-prose">
												A hand-written paragraph in <code>profile.json</code>, read as this session's standing instructions.
											</p>
										</>
									)}
								</div>
							) : null}
						</section>

						<MemorySection memory={details?.memory ?? null} loading={!details && !error} />
						<ScheduleSection data={details?.schedules ?? null} sandbox={sandbox} loading={!details && !error} />
					</div>

					<div className="ext-details-column">
						<section className="ext-details-card ext-details-pad">
							<p className="ext-details-caption">This Session</p>
							<div className="ext-details-facts">
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

						<section className="ext-details-card ext-details-pad">
							<p className="ext-details-caption">Status</p>
							<div className="ext-details-facts">
								<Fact label="Workspace" block tip={shown.workspace?.path ? tildifyPath(shown.workspace.path) : undefined}>
									{shown.workspace?.path ? formatWorkspacePath(shown.workspace.path, 34) : "—"}
								</Fact>
								<Fact label="Storage" block tip={tildifyPath(shown.storage)}>
									{shown.storage}
								</Fact>
								<Fact label="Size" tip={sizeParts}>
									<AnimatedNumber value={details?.size.bytes ?? 0} format={formatSize} />
								</Fact>
								{details?.models.length ? (
									<MenuValue label="Model" value={modelLabel} tip={details.model ? `${details.model.provider} · ${details.model.modelId ?? "default"}` : "default model"}>
										<ModelMenu groups={details.models} model={details.model} onSelect={(provider, modelId) => void setModel(provider, modelId)} />
									</MenuValue>
								) : (
									<Fact label="Model">{details ? modelLabel : "—"}</Fact>
								)}
								{details?.efforts.length ? (
									<MenuValue label="Effort" value={details.effort} tip="Effort (Thinking Level)">
										{details.efforts.map((level) => (
											<DropdownMenu.Item className="ext-details-menu-item" key={level} onSelect={() => void setEffort(level)}>
												<span>{level}</span>
												{level === details.effort ? <span className="ext-details-menu-check">✓</span> : null}
											</DropdownMenu.Item>
										))}
									</MenuValue>
								) : (
									<Fact label="Effort">{details ? (details.effort ?? "—") : "—"}</Fact>
								)}
								{details ? (
									<MenuValue label="Sandbox" value={sandbox} tip="default permission for new runs (global)">
										{SANDBOX_OPTIONS.map((option) => (
											<DropdownMenu.Item className="ext-details-menu-item" key={option.mode} onSelect={() => void setSandbox(option.mode)}>
												<span>{option.label}</span>
												{option.mode === details.sandbox ? <span className="ext-details-menu-check">✓</span> : null}
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
											<ul className="ext-details-chips">
												{details.skills.map((skill) => (
													<li key={skill.name}>
														{skill.name} <span className="ext-details-chip-note">· {skill.scope}</span>
													</li>
												))}
											</ul>
										) : (
											<span className="ext-details-muted">none granted</span>
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
											<ul className="ext-details-chips">
												{details.mcp.map((server) => (
													<li key={server.name}>
														<Tip label={server.state}>
															<span className={`ext-details-dot is-${server.state}`} />
														</Tip>{" "}
														{server.name} <span className="ext-details-chip-note">· {server.toolCount} tools</span>
													</li>
												))}
											</ul>
										) : (
											<span className="ext-details-muted">none granted</span>
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
