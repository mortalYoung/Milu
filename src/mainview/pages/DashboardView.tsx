import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { PartnerActivityDay } from "../../shared/rpc";
import { ActivityHeatmap, HEATMAP_WEEKS } from "../components/ActivityHeatmap";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { DashboardChart } from "../components/DashboardChart";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useDashboard } from "../lib/contexts/dashboard-context";
import { useInbox } from "../lib/contexts/inbox-context";
import { useSession } from "../lib/contexts/session-context";
import { digits, formatBytes, formatTokens, percent } from "../lib/utils";

const CAP = "font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-body-muted";
const NUM = "font-mono tabular-nums";
const WINDOWS = [7, 30, 90] as const;
const SORTS = [
	{ value: "fresh", label: "fresh" },
	{ value: "turns", label: "turns" },
	{ value: "ttft", label: "ttft" },
] as const;

function dayLabel(ts: number): string {
	const date = new Date(ts);
	return `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()]} ${date.getDate()}`;
}

function clock(ts: number): string {
	const date = new Date(ts);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function ms(value: number | null): string {
	if (value == null) return "—";
	return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

interface StatusRow {
	name: string;
	writing: boolean;
	queued: number;
	since: number | null;
	last: number;
	rank: number;
}

function lastSeen(ts: number): string {
	if (ts <= 0) return "—";
	return new Date(ts).toDateString() === new Date().toDateString() ? clock(ts) : dayLabel(ts);
}

function delta(now: number, before: number): { text: string; up: boolean } | null {
	if (before <= 0) return null;
	const change = ((now - before) / before) * 100;
	if (Math.abs(change) < 0.5) return null;
	return { text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`, up: change > 0 };
}

function windows(days: PartnerActivityDay[], span: number) {
	const recent = days.slice(-span);
	const previous = days.slice(-span * 2, -span);
	const sum = (list: PartnerActivityDay[], pick: (day: PartnerActivityDay) => number) => list.reduce((total, day) => total + pick(day), 0);
	return {
		turns: { now: sum(recent, (day) => day.turns), before: sum(previous, (day) => day.turns) },
		fresh: { now: sum(recent, (day) => day.freshTokens), before: sum(previous, (day) => day.freshTokens) },
	};
}

const isWorking = (writing: Record<string, boolean | undefined>, partners: { name: string; writing?: boolean }[], name: string) =>
	writing[name] ?? partners.find((partner) => partner.name === name)?.writing ?? false;

function useStable<T>(build: () => T, key: string): T {
	const held = useRef<{ key: string; value: T } | null>(null);
	if (held.current === null || held.current.key !== key) held.current = { key, value: build() };
	return held.current.value;
}

const StatusSection = memo(function StatusSection(props: { todayTurns: number; turnsByPartner: Map<string, number>; checked: string }) {
	const session = useSession();
	const status = useAgentStatus();
	const inbox = useInbox();
	const partners = useStore(session.store, (state) => state.partners);
	const writing = useStore(status.store, (state) => state.writing);
	const starts = useStore(status.store, (state) => state.starts);
	const queued = useStore(inbox.store, (state) => state.queued);

	const workingFor = (name: string) => isWorking(writing, partners, name);
	const queuedFor = (name: string) => queued[name]?.length ?? 0;
	const activeCount = partners.filter((partner) => workingFor(partner.name) || queuedFor(partner.name) > 0).length;
	const rows: StatusRow[] = partners
		.map((partner) => {
			const pending = queuedFor(partner.name);
			const isWriting = workingFor(partner.name);
			return {
				name: partner.name,
				writing: isWriting,
				queued: pending,
				since: starts[partner.name] ?? null,
				last: partner.lastMessageAt ?? 0,
				rank: isWriting ? 2 : pending > 0 ? 1 : 0,
			};
		})
		.sort((a, b) => b.rank - a.rank || b.last - a.last)
		.slice(0, Math.max(3, activeCount));

	const shareOf = (name: string): number => {
		if (props.todayTurns <= 0) return 0;
		return Math.min(100, ((props.turnsByPartner.get(name) ?? 0) / props.todayTurns) * 100);
	};

	return (
		<section className="dashboard-status" aria-label="Letter status">
			<div className="dashboard-status-head">
				<span className={CAP}>status · {activeCount > 0 ? "live" : "idle"}</span>
				<span className={`text-[9px] text-body-muted ${NUM}`}>
					{rows.length < partners.length ? `latest ${rows.length} of ${partners.length} · ` : ""}
					checked {props.checked}
				</span>
			</div>
			{rows.map((row) => {
				const share = shareOf(row.name);
				const turnsToday = props.turnsByPartner.get(row.name) ?? 0;
				return (
					<div className="dashboard-status-line" key={row.name}>
						<span className="dashboard-status-name">
							<span className={"work-dot" + (row.rank === 1 ? " queued" : row.rank === 0 ? " idle" : "")} />
							{row.name}
						</span>
						<span className={"dashboard-status-state" + (row.writing ? " writing" : "")}>{row.writing ? "writing" : row.rank === 1 ? `queued · ${row.queued}` : "idle"}</span>
						<span className="dashboard-status-phase">
							<span className={"dashboard-bar" + (row.rank === 1 ? " pending" : row.rank === 0 ? " idle" : "")}>
								<i style={{ width: row.rank === 1 ? "100%" : `${share}%` }} />
							</span>
							<span className={`dashboard-status-phase-text ${NUM}`}>{row.rank === 1 ? `${row.queued} waiting for ${row.name}` : `${share.toFixed(0)}% of today's turns`}</span>
						</span>
						<span className={`dashboard-status-read ${NUM}`}>
							{row.writing ? `${row.since ? `since ${clock(row.since)} · ` : ""}${turnsToday} turns today` : `last ${lastSeen(row.last)}`}
						</span>
					</div>
				);
			})}
		</section>
	);
});

function Sk(props: { className: string }) {
	return <span className={"dashboard-sk " + props.className} />;
}

function DashboardSkeleton() {
	return (
		<div className="dashboard-skel" aria-busy="true" aria-label="Loading the dashboard">
			<section className="dashboard-status">
				<div className="dashboard-status-head">
					<Sk className="h-[8px] w-[86px]" />
					<Sk className="h-[8px] w-[128px]" />
				</div>
				{[0, 1, 2].map((row) => (
					<div className="dashboard-status-line" key={row}>
						<Sk className="h-[8px]" />
						<Sk className="h-[8px]" />
						<Sk className="h-[3px] w-full" />
						<Sk className="h-[8px]" />
					</div>
				))}
			</section>

			<section className="dashboard-kv">
				{[0, 1, 2, 3, 4].map((cell) => (
					<div key={cell}>
						<Sk className="h-[8px] w-[52px]" />
						<Sk className="mt-[6px] h-[19px] w-[84px]" />
						<Sk className="mt-[6px] h-[8px] w-[62px]" />
					</div>
				))}
			</section>

			<section className="dashboard-charts">
				{[0, 1, 2].map((card) => (
					<figure className="dashboard-card" key={card}>
						<figcaption>
							<Sk className="h-[8px] w-[92px]" />
							<Sk className="h-[8px] w-[70px]" />
						</figcaption>
						<Sk className="h-[126px] w-full" />
					</figure>
				))}
			</section>

			<section className="dashboard-card dashboard-calendar">
				<figcaption>
					<Sk className="h-[8px] w-[172px]" />
					<Sk className="h-[8px] w-[146px]" />
				</figcaption>
				<Sk className="h-[84px] w-full" />
			</section>

			<div className="dashboard-split">
				<section className="dashboard-card dashboard-letters">
					<figcaption>
						<Sk className="h-[8px] w-[148px]" />
						<Sk className="h-[8px] w-[118px]" />
					</figcaption>
					<Sk className="fill" />
				</section>
				<section className="dashboard-card dashboard-runs">
					<figcaption>
						<Sk className="h-[8px] w-[92px]" />
						<Sk className="h-[8px] w-[54px]" />
					</figcaption>
					<Sk className="fill" />
				</section>
			</div>
		</div>
	);
}

const CalendarCard = memo(function CalendarCard(props: { days: PartnerActivityDay[] }) {
	return (
		<section className="dashboard-card dashboard-calendar" aria-label="Load per day, one year">
			<figcaption>
				<span className={CAP}>Load per day · last {Math.round(HEATMAP_WEEKS / 4.345)} months</span>
				<span className={`text-[9px] text-body-muted ${NUM}`}>Monday-aligned through today</span>
			</figcaption>
			<div className="overflow-x-auto">
				<div className="mx-auto w-max">
					<ActivityHeatmap days={props.days} />
				</div>
			</div>
		</section>
	);
});

export function DashboardView(props: { unread: (name: string) => boolean; onSelect: (name: string) => void }) {
	const session = useSession();
	const status = useAgentStatus();
	const dashboard = useDashboard();

	const partners = useStore(session.store, (state) => state.partners);
	const writing = useStore(status.store, (state) => state.writing);
	const overview = useStore(dashboard.store, (state) => state.overview);
	const loading = useStore(dashboard.store, (state) => state.loading);
	const asOf = useStore(dashboard.store, (state) => state.asOf);
	const span = useStore(dashboard.store, (state) => state.days);

	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<"fresh" | "turns" | "ttft">("fresh");

	useEffect(() => {
		void dashboard.refresh();
	}, [span, partners.length]);

	const todayTurns = overview?.heatmap.at(-1)?.turns ?? 0;
	const heatmapDays = overview?.heatmap ?? [];
	const heatmap = useStable(() => heatmapDays, `heatmap:${heatmapDays.length}:${heatmapDays.reduce((total, day) => total + day.turns + day.freshTokens + day.tools, 0)}`);
	const turnsByPartner = useStable(
		() => new Map((overview?.partners ?? []).map((partner) => [partner.name, partner.days.at(-1) ?? 0])),
		`today:${(overview?.partners ?? []).map((partner) => `${partner.name}:${partner.days.at(-1) ?? 0}`).join(",")}`,
	);

	const days = overview?.days ?? [];
	const labels = days.map((day) => dayLabel(day.ts));
	const moves = windows(overview?.heatmap ?? [], span);
	const windowLabel = days.length === 0 ? "—" : `${dayLabel(days[0]!.ts)} → ${dayLabel(days.at(-1)!.ts)}`;

	const rows = useMemo(() => {
		const stats = new Map((overview?.partners ?? []).map((partner) => [partner.name, partner]));
		const needle = query.trim().toLowerCase();
		return [...partners]
			.map((partner) => ({ partner, stats: stats.get(partner.name) }))
			.filter((row) => !needle || row.partner.name.toLowerCase().includes(needle))
			.sort((a, b) => {
				if (sort === "turns") return (b.stats?.turns ?? 0) - (a.stats?.turns ?? 0);
				if (sort === "ttft") return (a.stats?.ttftMedianMs ?? Infinity) - (b.stats?.ttftMedianMs ?? Infinity);
				return (b.stats?.freshTokens ?? 0) - (a.stats?.freshTokens ?? 0);
			});
	}, [overview, partners, query, sort]);

	const heaviest = Math.max(1, ...rows.map((row) => row.stats?.freshTokens ?? 0));
	const runs = overview?.runs ?? [];
	const totals = overview?.totals ?? null;
	const scanLabel = `${Math.round((overview?.activityWeeks ?? 0) / 4.345)} months`;
	const memoryFiles = totals?.memory
		? [
				{ label: "memories", bytes: totals.memory.memories },
				{ label: "scenes", bytes: totals.memory.scenes },
				{ label: "persona", bytes: totals.memory.persona },
				{ label: "runs", bytes: totals.memory.runs },
			]
		: [];

	return (
		<div className="dashboard-page">
			<div className="dashboard-scroll">
				<div className="dashboard-head">
					<div className="dashboard-title">
						<h1 className="font-serif text-[20px] font-semibold text-ink">Dashboard</h1>
						<span className={CAP}>
							{partners.length} letters · since {totals?.since ? dayLabel(totals.since) : "—"}
						</span>
					</div>
					<div className="dashboard-head-right">
						<div className="dashboard-seg" role="group" aria-label="Reading window">
							{WINDOWS.map((value) => (
								<button key={value} type="button" className={span === value ? "on" : undefined} aria-pressed={span === value} onClick={() => dashboard.setDays(value)}>
									{value}d
								</button>
							))}
						</div>
						<span className={`text-[9px] text-body-muted ${NUM}`}>{overview && asOf ? `data as of ${clock(asOf)}` : "loading…"}</span>
					</div>
				</div>

				{partners.length === 0 ? (
					<p className="mt-8 font-mono text-[11px] text-body-muted">—</p>
				) : !overview ? (
					<DashboardSkeleton />
				) : (
					<>
						<StatusSection todayTurns={todayTurns} turnsByPartner={turnsByPartner} checked={asOf ? clock(asOf) : "—"} />

						<section className="dashboard-kv" aria-label={`Totals over the last ${span} days`}>
							<div>
								<div className={CAP}>Turns · {span}d</div>
								<div className={`dashboard-kv-value ${NUM}`}>
									<AnimatedNumber value={moves.turns.now} format={digits} />
								</div>
								<div className={`dashboard-kv-note ${NUM}`}>
									{delta(moves.turns.now, moves.turns.before) ? (
										<span className={"dashboard-delta" + (delta(moves.turns.now, moves.turns.before)!.up ? " up" : "")}>
											{delta(moves.turns.now, moves.turns.before)!.text} vs prev
										</span>
									) : (
										`prev ${moves.turns.before.toLocaleString("en-US")}`
									)}
								</div>
							</div>
							<div>
								<div className={CAP}>Fresh · {span}d</div>
								<div className={`dashboard-kv-value ${NUM}`}>
									<AnimatedNumber value={moves.fresh.now} format={formatTokens} />
								</div>
								<div className={`dashboard-kv-note ${NUM}`}>
									{delta(moves.fresh.now, moves.fresh.before) ? (
										<span className={"dashboard-delta" + (delta(moves.fresh.now, moves.fresh.before)!.up ? " up" : "")}>
											{delta(moves.fresh.now, moves.fresh.before)!.text} vs prev
										</span>
									) : (
										`prev ${formatTokens(moves.fresh.before)}`
									)}
								</div>
							</div>
							<div>
								<div className={CAP}>Cache share</div>
								<div className={`dashboard-kv-value ${NUM}`}>
									{totals && totals.totalTokens > 0 ? <AnimatedNumber value={(totals.cacheTokens / totals.totalTokens) * 100} format={percent} /> : "—"}
								</div>
								<div className={`dashboard-kv-note ${NUM}`}>of {formatTokens(totals?.totalTokens ?? 0)} lifetime</div>
							</div>
							<div>
								<div className={CAP}>TTFT p50 · p90</div>
								<div className={`dashboard-kv-value ${NUM}`}>{totals?.ttftMedianMs != null ? <AnimatedNumber value={totals.ttftMedianMs} format={ms} /> : "—"}</div>
								<div className={`dashboard-kv-note ${NUM}`}>
									p90 {ms(totals?.ttftP90Ms ?? null)} · {totals?.ttftSamples ?? 0} samples
								</div>
							</div>
							<div>
								<div className={CAP}>Memory on disk</div>
								<div className={`dashboard-kv-value ${NUM}`}>
									<AnimatedNumber value={totals?.memory.total ?? 0} format={formatBytes} />
								</div>
								<div className={`dashboard-kv-note ${NUM}`}>run traces {formatBytes(totals?.memory.runs ?? 0)}</div>
							</div>
						</section>

						<section className={"dashboard-charts" + (loading ? " loading" : "")} aria-busy={loading} aria-label={`Per-day readings, ${windowLabel}`}>
							<figure className="dashboard-card">
								<figcaption>
									<span className={CAP}>Turns per day</span>
									<span className={`text-[9px] text-body-muted ${NUM}`}>{loading ? "loading…" : windowLabel}</span>
								</figcaption>
								<DashboardChart labels={labels} series={[{ label: "turns", values: days.map((day) => day.turns) }]} />
							</figure>
							<figure className="dashboard-card">
								<figcaption>
									<span className={CAP}>Fresh tokens per day</span>
									<span className={`text-[9px] text-body-muted ${NUM}`}>{loading ? "loading…" : `${formatTokens(moves.fresh.now)} in window`}</span>
								</figcaption>
								<DashboardChart labels={labels} series={[{ label: "fresh", values: days.map((day) => day.freshTokens), unit: " tok" }]} format={formatTokens} />
							</figure>
							<figure className="dashboard-card">
								<figcaption>
									<span className={CAP}>Tool calls per day</span>
									<span className={`text-[9px] text-body-muted ${NUM}`}>{loading ? "loading…" : `${totals?.tools ?? 0} lifetime`}</span>
								</figcaption>
								<DashboardChart labels={labels} series={[{ label: "tools", values: days.map((day) => day.tools) }]} />
							</figure>
						</section>

						<CalendarCard days={heatmap} />

						<div className="dashboard-split">
							<section className="dashboard-card dashboard-letters" aria-label="Letters">
								<figcaption>
									<span className={CAP}>Letters · counts over {scanLabel}</span>
									<span className="dashboard-controls">
										<input
											className="dashboard-search"
											type="search"
											placeholder="filter"
											aria-label="Filter letters"
											value={query}
											onChange={(event) => setQuery(event.currentTarget.value)}
										/>
										<span className="dashboard-seg small" role="group" aria-label="Sort letters">
											{SORTS.map((option) => (
												<button
													key={option.value}
													type="button"
													className={sort === option.value ? "on" : undefined}
													aria-pressed={sort === option.value}
													onClick={() => setSort(option.value)}
												>
													{option.label}
												</button>
											))}
										</span>
									</span>
								</figcaption>
								<div className="dashboard-table-scroll">
									<table className="dashboard-table">
										<thead>
											<tr>
												<th scope="col">Letter</th>
												<th scope="col">Fresh</th>
												<th scope="col" className="r">
													Turns
												</th>
												<th scope="col" className="r">
													TTFT
												</th>
												<th scope="col" className="r">
													Last
												</th>
											</tr>
										</thead>
										<tbody>
											{rows.map((row) => (
												<tr
													key={row.partner.name}
													className={isWorking(writing, partners, row.partner.name) ? "working" : undefined}
													tabIndex={0}
													onClick={() => props.onSelect(row.partner.name)}
													onKeyDown={(event) => {
														if (event.key === "Enter") props.onSelect(row.partner.name);
													}}
												>
													<td className="name">
														{row.partner.name}
														{row.partner.forkedFrom && <span className="dashboard-fork">fork</span>}
														{props.unread(row.partner.name) && <span className="conv-unread-dot" title="new messages" />}
													</td>
													<td>
														<span className="dashboard-fresh">
															<span className="dashboard-bar">
																<i style={{ width: `${((row.stats?.freshTokens ?? 0) / heaviest) * 100}%` }} />
															</span>
															<span className={NUM}>{row.stats ? formatTokens(row.stats.freshTokens) : "—"}</span>
														</span>
													</td>
													<td className="r">{row.stats ? row.stats.turns.toLocaleString("en-US") : "—"}</td>
													<td className="r">{ms(row.stats?.ttftMedianMs ?? null)}</td>
													<td className="r dim">{row.partner.lastMessageAt ? dayLabel(row.partner.lastMessageAt) : "—"}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</section>

							<section className="dashboard-card dashboard-runs" aria-label="Recent runs">
								<figcaption>
									<span className={CAP}>recent runs</span>
									<span className={`text-[9px] text-body-muted ${NUM}`}>{runs.length} today</span>
								</figcaption>
								<ul>
									{runs.length === 0 ? (
										<li className="dashboard-runs-empty">no memory run today yet</li>
									) : (
										runs.map((run, index) => (
											<li key={`${run.partner}:${run.startedAt}:${index}`}>
												<span className={`dashboard-runs-time ${NUM}`}>{clock(run.startedAt)}</span>
												<span className="dashboard-runs-body">
													<span className="dashboard-runs-who">{run.partner}</span>
													<span>
														{run.stage} · {run.reason === "completed" ? "ok" : run.reason}
														{run.added > 0 && ` · +${run.added}`}
													</span>
												</span>
												<span className={`dashboard-runs-ms ${NUM}`}>{ms(run.durationMs)}</span>
											</li>
										))
									)}
								</ul>
							</section>
						</div>

						<section className="dashboard-foot">
							<span className={`text-[9px] text-body-muted ${NUM}`}>read from each letter's own files · {formatTokens(totals?.freshTokens ?? 0)} fresh lifetime</span>
							<span className={`text-[9px] text-body-muted ${NUM}`}>{totals?.tps ? `${totals.tps.toFixed(1)} tok/s generation` : "no generation yet"}</span>
							<span className={`text-[9px] text-body-muted ${NUM}`}>
								{memoryFiles.map((file) => (
									<span className="dashboard-foot-file" key={file.label}>
										{file.label} {formatBytes(file.bytes)}
									</span>
								))}
							</span>
						</section>
					</>
				)}
			</div>
		</div>
	);
}
