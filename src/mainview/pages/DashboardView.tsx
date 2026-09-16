import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { PartnerActivityDay } from "../../shared/rpc";
import { ActivityHeatmap } from "../components/ActivityHeatmap";
import { useSession } from "../lib/contexts/session-context";
import { rpc } from "../lib/rpc";
import { formatBytes, formatTokens } from "../lib/utils";

/**
 * Ledger — the aggregate first, the individual letters below it.
 *
 * Volume is measured in fresh tokens (input + output + cache-write), not total: on this machine
 * 99% of all tokens are prompt-cache re-reads, so a total-token curve would mostly plot the cache.
 * Every window label is derived from the data or from DASHBOARD_WINDOW_DAYS — never written by hand.
 */

const CAP = "font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-body-muted";
const NUM = "font-mono tabular-nums";
const TICKS = [0, 1, 2, 3];
/** Calendar horizon. The label below is derived from this same value, never written by hand. */
const HEATMAP_WEEKS = 52;
const HEATMAP_MONTHS = `${Math.round(HEATMAP_WEEKS / 4.345)} months`;

function ms(value: number | null): string {
	if (value == null) return "—";
	return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function decimal(value: number | null, digits: number, suffix: string): string {
	return value == null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function dayLabel(ts: number): string {
	const date = new Date(ts);
	return `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()]} ${date.getDate()}`;
}

export function DashboardView(props: { unread: (name: string) => boolean }) {
	const session = useSession();
	const [overview, { refetch }] = createResource(
		() => session.data.partners.length,
		async () => (await rpc.request.dashboard_overview({})).overview,
	);
	const [focused, setFocused] = createSignal<string | null>(null);
	const hoverable = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

	rpc.addMessageListener("agent_end", () => void refetch());

	const partners = createMemo(() => {
		const stats = new Map((overview()?.partners ?? []).map((partner) => [partner.name, partner]));
		return [...session.data.partners].map((partner) => ({ partner, stats: stats.get(partner.name) })).sort((a, b) => (b.stats?.freshTokens ?? 0) - (a.stats?.freshTokens ?? 0));
	});
	const heaviest = createMemo(() => partners()[0]?.stats?.freshTokens ?? 0);
	const unreadCount = createMemo(() => session.data.partners.filter((partner) => props.unread(partner.name)).length);
	const heatmapDays = createMemo(() => overview()?.heatmap ?? []);
	const forks = createMemo(() => session.data.partners.filter((partner) => partner.forkedFrom).length);

	// The curve redraws from a single letter while that row is focused: a reading of "when did this one work".
	const curve = createMemo(() => {
		const data = overview();
		if (!data) return { days: [] as PartnerActivityDay[], values: [] as number[], peak: 0, focused: false };
		const source = focused();
		const stats = source ? data.partners.find((partner) => partner.name === source) : undefined;
		const values = stats ? stats.days : data.days.map((day) => day.turns);
		return { days: data.days, values, peak: Math.max(1, ...values), focused: Boolean(stats) };
	});
	const windowLabel = createMemo(() => {
		const days = curve().days;
		if (days.length === 0) return "";
		return `${dayLabel(days[0]!.ts)} → ${dayLabel(days.at(-1)!.ts)}`;
	});
	const sinceLabel = createMemo(() => {
		const since = overview()?.totals.since;
		return since == null ? null : dayLabel(since);
	});

	return (
		<div class="flex-1 min-h-0 overflow-y-auto">
			<div class="flex flex-col px-6 py-6">
				<div class="flex items-baseline justify-between gap-4">
					<h1 class="font-serif text-[20px] font-semibold text-ink text-balance">Ledger</h1>
					<p class={CAP}>
						{session.data.partners.length} letters · {forks()} forks · {unreadCount()} unread
						<Show when={sinceLabel()}> · since {sinceLabel()}</Show>
					</p>
				</div>

				<Show when={session.data.partners.length > 0} fallback={<p class="mt-8 font-mono text-[11px] text-body-muted">—</p>}>
					<Show when={overview()} fallback={<div class="mt-6 h-[280px]" aria-busy="true" />}>
						{(data) => (
							<>
								{/* ——— totals ——— */}
								<div class="mt-5 grid grid-cols-2 gap-x-4 border-y-2 border-y-ink pt-3 pb-3 sm:grid-cols-3 lg:grid-cols-5">
									<div class="border-b border-hairline pb-3 last:border-b-0 lg:border-b-0 lg:border-r lg:pr-4 lg:[&:last-child]:border-r-0">
										<div class={CAP}>Turns</div>
										<div class={`mt-1 text-[20px] font-medium leading-none tracking-[-0.02em] text-ink ${NUM}`}>{data().totals.turns.toLocaleString("en-US")}</div>
										<div class={`mt-1 text-[9px] text-body-muted ${NUM}`}>{data().totals.tools.toLocaleString("en-US")} tool calls</div>
									</div>
									<div class="border-b border-hairline pb-3 last:border-b-0 lg:border-b-0 lg:border-r lg:pr-4 lg:[&:last-child]:border-r-0">
										<div class={CAP}>Fresh</div>
										<div class={`mt-1 text-[20px] font-medium leading-none tracking-[-0.02em] text-ink ${NUM}`}>{formatTokens(data().totals.freshTokens)}</div>
										<div class={`mt-1 text-[9px] text-body-muted ${NUM}`}>new tokens</div>
									</div>
									<div class="border-b border-hairline pb-3 last:border-b-0 lg:border-b-0 lg:border-r lg:pr-4 lg:[&:last-child]:border-r-0">
										<div class={CAP}>Cache</div>
										<div class={`mt-1 text-[20px] font-medium leading-none tracking-[-0.02em] text-ink ${NUM}`}>{formatTokens(data().totals.cacheTokens)}</div>
										<div class={`mt-1 text-[9px] text-body-muted ${NUM}`}>
											{data().totals.totalTokens > 0
												? `${((data().totals.cacheTokens / data().totals.totalTokens) * 100).toFixed(1)}% of ${formatTokens(data().totals.totalTokens)}`
												: "—"}
										</div>
									</div>
									<div class="border-b border-hairline pb-3 last:border-b-0 lg:border-b-0 lg:border-r lg:pr-4 lg:[&:last-child]:border-r-0">
										<div class={CAP}>Time to first token</div>
										<div class={`mt-1 text-[20px] font-medium leading-none tracking-[-0.02em] text-ink ${NUM}`}>{ms(data().totals.ttftMedianMs)}</div>
										<div class={`mt-1 text-[9px] text-body-muted ${NUM}`}>
											p90 {ms(data().totals.ttftP90Ms)} · {data().totals.ttftSamples} samples
										</div>
									</div>
									<div class="border-b border-hairline pb-3 last:border-b-0 lg:border-b-0 lg:border-r lg:pr-4 lg:[&:last-child]:border-r-0">
										<div class={CAP}>Memory on disk</div>
										<div class={`mt-1 text-[20px] font-medium leading-none tracking-[-0.02em] text-ink ${NUM}`}>{formatBytes(data().totals.memory.total)}</div>
										<div class={`mt-1 text-[9px] text-body-muted ${NUM}`}>run traces {formatBytes(data().totals.memory.runs)}</div>
									</div>
								</div>

								{/* ——— daily columns ——— */}
								<div class="mt-5">
									<div class="flex items-baseline justify-between gap-4">
										<span class={CAP}>Turns per day · {windowLabel()}</span>
										<Show when={curve().focused}>
											<span class={`text-[9px] text-seal ${NUM}`}>showing {focused()} · move the pointer away to return to all letters</span>
										</Show>
									</div>
									<div
										class="mt-2 grid h-[92px] items-end border-t border-hairline"
										style={{ "grid-template-columns": `repeat(${curve().days.length}, minmax(0, 1fr))` }}
										role="img"
										aria-label={`Turns per day, ${windowLabel()}: ${curve()
											.days.map((day, index) => `${dayLabel(day.ts)} ${curve().values[index] ?? 0}`)
											.join(", ")}`}
									>
										<For each={curve().days}>
											{(day, index) => (
												<div class="flex h-full flex-col justify-end border-r border-hairline px-3 last:border-r-0">
													<i
														class="block bg-seal"
														style={{ height: `${Math.round(((curve().values[index()] ?? 0) / curve().peak) * 62)}px`, opacity: curve().focused ? "0.32" : "0.7" }}
													/>
													<span class={`mt-1.5 text-[10.5px] font-medium text-ink ${NUM}`}>{curve().values[index()] ?? 0}</span>
													<span class={`text-[9px] text-body-muted ${NUM}`}>{dayLabel(day.ts)}</span>
												</div>
											)}
										</For>
									</div>
								</div>

								{/* ——— calendar ——— */}
								<div class="mt-6">
									<div class="flex items-baseline justify-between gap-4">
										<span class={CAP}>Load per day · last {HEATMAP_MONTHS}</span>
										<span class={`text-[9px] text-body-muted ${NUM}`}>shade blends turns and new tokens</span>
									</div>
									<div class="mt-2 overflow-x-auto">
										<div class="mx-auto w-max">
											<ActivityHeatmap days={heatmapDays()} />
										</div>
									</div>
								</div>

								{/* ——— the letters ——— */}
								<div class="mt-6">
									<table class="w-full border-collapse">
										<thead>
											<tr class="border-b border-ink">
												<th scope="col" class={`pb-1.5 text-left ${CAP}`}>
													Letter
												</th>
												<th scope="col" class={`pb-1.5 text-left ${CAP}`}>
													Fresh tokens
												</th>
												<th scope="col" class={`pb-1.5 text-right ${CAP}`}>
													Turns
												</th>
												<th scope="col" class={`pb-1.5 text-right ${CAP}`}>
													TTFT
												</th>
												<th scope="col" class={`pb-1.5 text-right ${CAP}`}>
													Memory
												</th>
												<th scope="col" class={`pb-1.5 text-right ${CAP}`}>
													Last run
												</th>
											</tr>
										</thead>
										<tbody>
											<For each={partners()}>
												{(row) => (
													<tr
														class="border-b border-hairline-soft transition-colors duration-[120ms] hover:bg-paper-hover focus-visible:bg-paper-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-seal/40 focus-visible:outline-none motion-reduce:transition-none"
														classList={{ "bg-paper-deep": focused() === row.partner.name }}
														tabIndex={0}
														onPointerEnter={() => hoverable() && setFocused(row.partner.name)}
														onPointerLeave={(event) => hoverable() && !event.currentTarget.contains(document.activeElement) && setFocused(null)}
														onFocus={() => setFocused(row.partner.name)}
														onBlur={() => setFocused(null)}
													>
														<td class="py-2 pr-4">
															<span
																class="font-sans text-[13.5px] font-semibold tracking-[-0.01em]"
																classList={{ "text-seal": focused() === row.partner.name, "text-ink": focused() !== row.partner.name }}
															>
																{row.partner.name}
															</span>
															<Show when={row.partner.forkedFrom}>
																<span class="ml-2 font-sans text-[10px] text-body-muted">fork</span>
															</Show>
															<div class={`text-[9px] text-body-muted ${NUM}`}>{row.partner.lastMessageAt ? dayLabel(row.partner.lastMessageAt) : "—"}</div>
														</td>
														<td class="py-2 pr-4">
															<div class="flex items-center gap-2">
																<div class="relative flex h-3 min-w-0 flex-1 items-center">
																	<div class="absolute inset-x-0 top-[5px] h-0.5 bg-hairline" />
																	<div class="absolute inset-0 grid grid-cols-4">
																		<For each={TICKS}>{(tick) => <i class={tick < 3 ? "border-r border-hairline" : ""} />}</For>
																	</div>
																	<div
																		class="relative h-3 bg-seal"
																		style={{ width: `${heaviest() > 0 ? ((row.stats?.freshTokens ?? 0) / heaviest()) * 100 : 0}%`, opacity: 0.28 }}
																	/>
																</div>
																<span class={`w-[46px] shrink-0 text-right text-[10.5px] text-ink-soft ${NUM}`}>{row.stats ? formatTokens(row.stats.freshTokens) : "—"}</span>
															</div>
														</td>
														<td class={`py-2 pr-4 text-right text-[12px] text-ink ${NUM}`}>{row.stats ? row.stats.turns.toLocaleString("en-US") : "—"}</td>
														<td class={`py-2 pr-4 text-right text-[11px] text-ink-soft ${NUM}`}>{ms(row.stats?.ttftMedianMs ?? null)}</td>
														<td class={`py-2 pr-4 text-right text-[11px] text-ink-soft ${NUM}`}>
															{row.stats && row.stats.memory.total > 0 ? formatBytes(row.stats.memory.total) : "—"}
														</td>
														<td class={`py-2 text-right text-[9px] uppercase tracking-[0.08em] text-body-muted ${NUM}`}>
															<Show when={row.stats?.lastRun} fallback="—">
																{(run) => (
																	<>
																		{run().stage} {run().reason === "completed" ? "ok" : run().reason}
																		<Show when={run().added > 0}> · +{run().added}</Show>
																	</>
																)}
															</Show>
														</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>

								<p class={`mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[9px] uppercase tracking-[0.08em] text-body-muted ${NUM}`}>
									<span>{decimal(data().totals.tps, 1, " tokens/s generation")}</span>
									<span>read from each letter's own files · recorded since {sinceLabel() ?? "—"}</span>
								</p>
							</>
						)}
					</Show>
				</Show>
			</div>
		</div>
	);
}
