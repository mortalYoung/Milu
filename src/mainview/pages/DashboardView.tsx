import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { DashboardPartnerStats, DashboardTotals, PartnerActivityDay } from "../../shared/rpc";
import { ActivityHeatmap, HEATMAP_WEEKS } from "../components/ActivityHeatmap";
import { DashboardChart } from "../components/DashboardChart";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useInbox } from "../lib/contexts/inbox-context";
import { useSession } from "../lib/contexts/session-context";
import { rpc } from "../lib/rpc";
import { formatBytes, formatTokens } from "../lib/utils";

/**
 * The dashboard, read as a console: what is happening now, what the window adds up to, how it moved, and
 * who did it. Every panel here is fed by `dashboard_overview` and the session store — no gauge is drawn
 * that has nothing behind it, and the window control is the same number the query used (P-55, P-60).
 */

const CAP = "font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-body-muted";
const NUM = "font-mono tabular-nums";
/** The windows a reader actually asks for: the rhythm, the month, the quarter. */
const WINDOWS = [7, 30, 90] as const;
/** What the letters table can be ordered by, and the word on its button. */
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

/** One row of the status block: what a letter is doing, and the last time it did anything. */
interface StatusRow {
	name: string;
	writing: boolean;
	queued: number;
	since: number | null;
	last: number;
	/** writing 2 / queued 1 / idle 0 — the sort key and the row's state in one number. */
	rank: number;
}

/** Today reads as a clock, anything older as a date: "last 21:06" beats "last SEP 17". */
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

/** Two equal windows ending today, off the dense calendar: the delta a lifetime average can never give. */
function windows(days: PartnerActivityDay[], span: number) {
	const recent = days.slice(-span);
	const previous = days.slice(-span * 2, -span);
	const sum = (list: PartnerActivityDay[], pick: (day: PartnerActivityDay) => number) => list.reduce((total, day) => total + pick(day), 0);
	return {
		turns: { now: sum(recent, (day) => day.turns), before: sum(previous, (day) => day.turns) },
		fresh: { now: sum(recent, (day) => day.freshTokens), before: sum(previous, (day) => day.freshTokens) },
	};
}

export function DashboardView(props: { unread: (name: string) => boolean }) {
	const session = useSession();
	const status = useAgentStatus();
	const inbox = useInbox();
	const [span, setSpan] = createSignal<(typeof WINDOWS)[number]>(7);
	const [asOf, setAsOf] = createSignal<number | null>(null);
	const [query, setQuery] = createSignal("");
	const [sort, setSort] = createSignal<"fresh" | "turns" | "ttft">("fresh");

	const [overview, { refetch }] = createResource(
		() => ({ partners: session.data.partners.length, days: span() }),
		async (key) => {
			const result = await rpc.request.dashboard_overview({ days: key.days });
			setAsOf(Date.now());
			return result.overview;
		},
	);

	rpc.addMessageListener("agent_end", () => void refetch());

	// ——— live: the letters that moved most recently, whatever they are doing ———
	const activeCount = createMemo(() => session.data.partners.filter((partner) => status.workingFor(partner.name) || inbox.list(partner.name).length > 0).length);
	const statusRows = createMemo<StatusRow[]>(() => {
		const ranked = session.data.partners
			.map((partner) => {
				const queued = inbox.list(partner.name).length;
				const writing = status.workingFor(partner.name);
				return {
					name: partner.name,
					writing,
					queued,
					since: status.sinceFor(partner.name),
					last: partner.lastMessageAt ?? 0,
					rank: writing ? 2 : queued > 0 ? 1 : 0,
				};
			})
			.sort((a, b) => b.rank - a.rank || b.last - a.last);
		/** Three rows is the reading; a letter that is actually live is never dropped for a quiet one. */
		return ranked.slice(0, Math.max(3, activeCount()));
	});
	const todayTurns = createMemo(() => overview()?.heatmap.at(-1)?.turns ?? 0);
	/** Honest proportional: this letter's share of today's turns, not a made-up progress bar. */
	const shareOfToday = (stats: DashboardPartnerStats | undefined) => {
		const total = todayTurns();
		if (!stats || total <= 0) return 0;
		return Math.min(100, ((stats.days.at(-1) ?? 0) / total) * 100);
	};

	// ——— the window ———
	const days = createMemo(() => overview()?.days ?? []);
	const labels = createMemo(() => days().map((day) => dayLabel(day.ts)));
	const moves = createMemo(() => windows(overview()?.heatmap ?? [], span()));
	const windowLabel = createMemo(() => {
		const list = days();
		return list.length === 0 ? "—" : `${dayLabel(list[0]!.ts)} → ${dayLabel(list.at(-1)!.ts)}`;
	});

	// ——— the letters ———
	const rows = createMemo(() => {
		const stats = new Map((overview()?.partners ?? []).map((partner) => [partner.name, partner]));
		const needle = query().trim().toLowerCase();
		return [...session.data.partners]
			.map((partner) => ({ partner, stats: stats.get(partner.name) }))
			.filter((row) => !needle || row.partner.name.toLowerCase().includes(needle))
			.sort((a, b) => {
				if (sort() === "turns") return (b.stats?.turns ?? 0) - (a.stats?.turns ?? 0);
				if (sort() === "ttft") return (a.stats?.ttftMedianMs ?? Infinity) - (b.stats?.ttftMedianMs ?? Infinity);
				return (b.stats?.freshTokens ?? 0) - (a.stats?.freshTokens ?? 0);
			});
	});
	const heaviest = createMemo(() => Math.max(1, ...rows().map((row) => row.stats?.freshTokens ?? 0)));
	const runs = createMemo(() =>
		(overview()?.partners ?? [])
			.filter((partner) => partner.lastRun)
			.sort((a, b) => (b.lastRun?.startedAt ?? 0) - (a.lastRun?.startedAt ?? 0))
			.slice(0, 6),
	);
	const totals = createMemo<DashboardTotals | null>(() => overview()?.totals ?? null);
	/** The letters' counts are scanned over this whole horizon; every label beside them says so. */
	const scanLabel = createMemo(() => `${Math.round((overview()?.activityWeeks ?? 0) / 4.345)} months`);
	const memoryFiles = createMemo(() => {
		const memory = totals()?.memory;
		if (!memory) return [];
		return [
			{ label: "memories", bytes: memory.memories },
			{ label: "scenes", bytes: memory.scenes },
			{ label: "persona", bytes: memory.persona },
			{ label: "runs", bytes: memory.runs },
		];
	});

	return (
		<div class="dashboard-page">
			<div class="dashboard-scroll">
				{/* ——— head: the window, and when this reading was taken ——— */}
				<div class="dashboard-head">
					<div class="dashboard-title">
						<h1 class="font-serif text-[20px] font-semibold text-ink">Dashboard</h1>
						<span class={CAP}>
							{session.data.partners.length} letters · since {totals()?.since ? dayLabel(totals()!.since!) : "—"}
						</span>
					</div>
					<div class="dashboard-head-right">
						<div class="dashboard-seg" role="group" aria-label="Reading window">
							<For each={WINDOWS}>
								{(value) => (
									<button type="button" classList={{ on: span() === value }} aria-pressed={span() === value} onClick={() => setSpan(value)}>
										{value}d
									</button>
								)}
							</For>
						</div>
						<span class={`text-[9px] text-body-muted ${NUM}`}>data as of {asOf() ? clock(asOf()!) : "—"}</span>
					</div>
				</div>

				<Show when={session.data.partners.length > 0} fallback={<p class="mt-8 font-mono text-[11px] text-body-muted">—</p>}>
					<Show when={overview()} fallback={<div class="dashboard-skeleton" aria-busy="true" />}>
						<>
							{/* ——— now: the three most recent letters, four fixed columns so the bars line up ——— */}
							<section class="dashboard-status" aria-label="Letter status">
								<div class="dashboard-status-head">
									<span class={CAP}>status · {activeCount() > 0 ? "live" : "idle"}</span>
									<span class={`text-[9px] text-body-muted ${NUM}`}>
										{statusRows().length < session.data.partners.length ? `latest ${statusRows().length} of ${session.data.partners.length} · ` : ""}
										{asOf() ? `checked ${clock(asOf()!)}` : "—"}
									</span>
								</div>
								<For each={statusRows()}>
									{(row) => {
										const stats = () => overview()?.partners.find((partner) => partner.name === row.name);
										const share = () => shareOfToday(stats());
										const turnsToday = () => stats()?.days.at(-1) ?? 0;
										return (
											<div class="dashboard-status-line">
												<span class="dashboard-status-name">
													<span class="work-dot" classList={{ queued: row.rank === 1, idle: row.rank === 0 }} />
													{row.name}
												</span>
												<span class={`dashboard-status-state ${row.writing ? "writing" : ""}`}>{row.writing ? "writing" : row.rank === 1 ? `queued · ${row.queued}` : "idle"}</span>
												<span class="dashboard-status-phase">
													<span class="dashboard-bar" classList={{ pending: row.rank === 1, idle: row.rank === 0 }}>
														<i style={{ width: row.rank === 1 ? "100%" : `${share()}%` }} />
													</span>
													<span class={`dashboard-status-phase-text ${NUM}`}>
														{row.rank === 1 ? `${row.queued} waiting for ${row.name}` : `${share().toFixed(0)}% of today's turns`}
													</span>
												</span>
												<span class={`dashboard-status-read ${NUM}`}>
													{row.writing ? `${row.since ? `since ${clock(row.since)} · ` : ""}${turnsToday()} turns today` : `last ${lastSeen(row.last)}`}
												</span>
											</div>
										);
									}}
								</For>
							</section>

							{/* ——— the window, in five cells: one unit each, each with its move ——— */}
							<section class="dashboard-kv" aria-label={`Totals over the last ${span()} days`}>
								<div>
									<div class={CAP}>Turns · {span()}d</div>
									<div class={`dashboard-kv-value ${NUM}`}>{moves().turns.now.toLocaleString("en-US")}</div>
									<div class={`dashboard-kv-note ${NUM}`}>
										<Show when={delta(moves().turns.now, moves().turns.before)} fallback={`prev ${moves().turns.before.toLocaleString("en-US")}`}>
											{(move) => <span classList={{ "dashboard-delta": true, up: move().up }}>{move().text} vs prev</span>}
										</Show>
									</div>
								</div>
								<div>
									<div class={CAP}>Fresh · {span()}d</div>
									<div class={`dashboard-kv-value ${NUM}`}>{formatTokens(moves().fresh.now)}</div>
									<div class={`dashboard-kv-note ${NUM}`}>
										<Show when={delta(moves().fresh.now, moves().fresh.before)} fallback={`prev ${formatTokens(moves().fresh.before)}`}>
											{(move) => <span classList={{ "dashboard-delta": true, up: move().up }}>{move().text} vs prev</span>}
										</Show>
									</div>
								</div>
								<div>
									<div class={CAP}>Cache share</div>
									<div class={`dashboard-kv-value ${NUM}`}>
										{totals() && totals()!.totalTokens > 0 ? `${((totals()!.cacheTokens / totals()!.totalTokens) * 100).toFixed(1)}%` : "—"}
									</div>
									<div class={`dashboard-kv-note ${NUM}`}>of {formatTokens(totals()?.totalTokens ?? 0)} lifetime</div>
								</div>
								<div>
									<div class={CAP}>TTFT p50 · p90</div>
									<div class={`dashboard-kv-value ${NUM}`}>{ms(totals()?.ttftMedianMs ?? null)}</div>
									<div class={`dashboard-kv-note ${NUM}`}>
										p90 {ms(totals()?.ttftP90Ms ?? null)} · {totals()?.ttftSamples ?? 0} samples
									</div>
								</div>
								<div>
									<div class={CAP}>Memory on disk</div>
									<div class={`dashboard-kv-value ${NUM}`}>{formatBytes(totals()?.memory.total ?? 0)}</div>
									<div class={`dashboard-kv-note ${NUM}`}>run traces {formatBytes(totals()?.memory.runs ?? 0)}</div>
								</div>
							</section>

							{/* ——— three readings of the same window; hover any of them for the day ——— */}
							<section class="dashboard-charts" aria-label={`Per-day readings, ${windowLabel()}`}>
								<figure class="dashboard-card">
									<figcaption>
										<span class={CAP}>Turns per day</span>
										<span class={`text-[9px] text-body-muted ${NUM}`}>{windowLabel()}</span>
									</figcaption>
									<DashboardChart labels={labels()} series={[{ label: "turns", values: days().map((day) => day.turns) }]} />
								</figure>
								<figure class="dashboard-card">
									<figcaption>
										<span class={CAP}>Fresh tokens per day</span>
										<span class={`text-[9px] text-body-muted ${NUM}`}>{formatTokens(moves().fresh.now)} in window</span>
									</figcaption>
									<DashboardChart labels={labels()} series={[{ label: "fresh", values: days().map((day) => day.freshTokens), unit: " tok" }]} format={formatTokens} />
								</figure>
								<figure class="dashboard-card">
									<figcaption>
										<span class={CAP}>Tool calls per day</span>
										<span class={`text-[9px] text-body-muted ${NUM}`}>{totals()?.tools ?? 0} lifetime</span>
									</figcaption>
									<DashboardChart labels={labels()} series={[{ label: "tools", values: days().map((day) => day.tools) }]} />
								</figure>
							</section>

							{/* ——— the calendar stays: it is the only view with a year in it ——— */}
							<section class="dashboard-card dashboard-calendar" aria-label="Load per day, one year">
								<figcaption>
									<span class={CAP}>Load per day · last {Math.round(HEATMAP_WEEKS / 4.345)} months</span>
									<span class={`text-[9px] text-body-muted ${NUM}`}>Monday-aligned through today</span>
								</figcaption>
								<div class="overflow-x-auto">
									<div class="mx-auto w-max">
										<ActivityHeatmap days={overview()?.heatmap ?? []} />
									</div>
								</div>
							</section>

							{/* ——— the letters, and what they did last ——— */}
							<div class="dashboard-split">
								<section class="dashboard-card dashboard-letters" aria-label="Letters">
									<figcaption>
										<span class={CAP}>Letters · counts over {scanLabel()}</span>
										<span class="dashboard-controls">
											<input
												class="dashboard-search"
												type="search"
												placeholder="filter"
												aria-label="Filter letters"
												value={query()}
												onInput={(event) => setQuery(event.currentTarget.value)}
											/>
											<span class="dashboard-seg small" role="group" aria-label="Sort letters">
												<For each={SORTS}>
													{(option) => (
														<button type="button" classList={{ on: sort() === option.value }} aria-pressed={sort() === option.value} onClick={() => setSort(option.value)}>
															{option.label}
														</button>
													)}
												</For>
											</span>
										</span>
									</figcaption>
									<table class="dashboard-table">
										<thead>
											<tr>
												<th scope="col">Letter</th>
												<th scope="col">Fresh</th>
												<th scope="col" class="r">
													Turns
												</th>
												<th scope="col" class="r">
													TTFT
												</th>
												<th scope="col" class="r">
													Last
												</th>
											</tr>
										</thead>
										<tbody>
											<For each={rows()}>
												{(row) => (
													<tr
														classList={{ working: status.workingFor(row.partner.name) }}
														tabIndex={0}
														onClick={() => session.mutate.select(row.partner)}
														onKeyDown={(event) => {
															if (event.key === "Enter") session.mutate.select(row.partner);
														}}
													>
														<td class="name">
															{row.partner.name}
															<Show when={row.partner.forkedFrom}>
																<span class="dashboard-fork">fork</span>
															</Show>
															<Show when={props.unread(row.partner.name)}>
																<span class="conv-unread-dot" title="new messages" />
															</Show>
														</td>
														<td>
															<span class="dashboard-fresh">
																<span class="dashboard-bar">
																	<i style={{ width: `${((row.stats?.freshTokens ?? 0) / heaviest()) * 100}%` }} />
																</span>
																<span class={`${NUM}`}>{row.stats ? formatTokens(row.stats.freshTokens) : "—"}</span>
															</span>
														</td>
														<td class="r">{row.stats ? row.stats.turns.toLocaleString("en-US") : "—"}</td>
														<td class="r">{ms(row.stats?.ttftMedianMs ?? null)}</td>
														<td class="r dim">{row.partner.lastMessageAt ? dayLabel(row.partner.lastMessageAt) : "—"}</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</section>

								<section class="dashboard-card dashboard-runs" aria-label="Recent runs">
									<figcaption>
										<span class={CAP}>recent runs</span>
										<span class={`text-[9px] text-body-muted ${NUM}`}>{runs().length} letters</span>
									</figcaption>
									<ul>
										<For each={runs()} fallback={<li class="dashboard-runs-empty">no memory runs recorded yet</li>}>
											{(partner) => (
												<li>
													<span class={`dashboard-runs-time ${NUM}`}>{clock(partner.lastRun!.startedAt)}</span>
													<span class="dashboard-runs-body">
														<span class="dashboard-runs-who">{partner.name}</span>
														<span>
															{partner.lastRun!.stage} · {partner.lastRun!.reason === "completed" ? "ok" : partner.lastRun!.reason}
															<Show when={partner.lastRun!.added > 0}> · +{partner.lastRun!.added}</Show>
														</span>
													</span>
													<span class={`dashboard-runs-ms ${NUM}`}>{ms(partner.lastRun!.durationMs)}</span>
												</li>
											)}
										</For>
									</ul>
								</section>
							</div>

							{/* ——— the small print: where this came from, and what the memory actually holds ——— */}
							<section class="dashboard-foot">
								<span class={`text-[9px] text-body-muted ${NUM}`}>read from each letter's own files · {formatTokens(totals()?.freshTokens ?? 0)} fresh lifetime</span>
								<span class={`text-[9px] text-body-muted ${NUM}`}>{totals()?.tps ? `${totals()!.tps!.toFixed(1)} tok/s generation` : "no generation yet"}</span>
								<span class={`text-[9px] text-body-muted ${NUM}`}>
									<For each={memoryFiles()}>
										{(file) => (
											<span class="dashboard-foot-file">
												{file.label} {formatBytes(file.bytes)}
											</span>
										)}
									</For>
								</span>
							</section>
						</>
					</Show>
				</Show>
			</div>
		</div>
	);
}
