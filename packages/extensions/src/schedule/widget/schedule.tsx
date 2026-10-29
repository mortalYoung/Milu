import { describeNextRun, type DialogProps, type SlotProps } from "@milu/window/api";
import { Tip } from "@milu/window/api/tooltip";
import * as Popover from "@radix-ui/react-popover";
import { AlarmClock } from "lucide-react";
import { useState } from "react";

interface ScheduleView {
	readonly id: string;
	readonly title: string;
	readonly display: string;
	readonly payload: { readonly text: string };
	readonly enabled: boolean;
	readonly lifecycleStatus: "active" | "paused" | "finished";
	readonly nextRunAt: number | null;
	readonly runCount: number;
}

interface RunView {
	readonly runId: string;
	readonly scheduleId: string;
	readonly scheduledAt: number;
	readonly dispatchedAt: number | null;
	readonly trigger: "schedule" | "manual" | "catchup";
	readonly status: "dispatched" | "skipped" | "missed";
	readonly error?: string;
}

interface ScheduleData {
	readonly session: string;
	readonly schedules: readonly ScheduleView[];
	readonly runs: readonly RunView[];
}

interface TimelineRow {
	readonly session: string;
	readonly id: string;
	readonly title: string;
	readonly at: number;
}

const WELCOME_MAX_ROWS = 3;

const STATUS_TEXT: Record<RunView["status"], string> = {
	dispatched: "sent",
	missed: "missed",
	skipped: "skipped",
};

function clockTime(at: number | null): string {
	if (at === null) return "—";
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scheduleStatus(item: ScheduleView): string {
	return item.enabled && item.lifecycleStatus === "active" ? "active" : item.lifecycleStatus;
}

export function ScheduleButton(props: SlotProps) {
	const data = props.data as ScheduleData | null;
	if (!data || data.schedules.length === 0) return null;

	const active = data.schedules.filter((item) => item.enabled && item.lifecycleStatus === "active");
	const next = active
		.map((item) => item.nextRunAt)
		.filter((value): value is number => value !== null)
		.sort((left, right) => left - right)[0];
	const last = [...data.runs].sort((left, right) => (right.dispatchedAt ?? right.scheduledAt) - (left.dispatchedAt ?? left.scheduledAt))[0];
	const label = `${data.schedules.length} scheduled task${data.schedules.length === 1 ? "" : "s"}${next === undefined ? "" : ` · next ${clockTime(next)}`}`;
	const summary = [
		`${active.length} active`,
		next === undefined ? "nothing scheduled" : `next ${clockTime(next)}`,
		last ? `last ${STATUS_TEXT[last.status]} ${clockTime(last.dispatchedAt ?? last.scheduledAt)}` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Popover.Root>
			<Popover.Trigger asChild>
				<button
					type="button"
					className="ml-1.5 flex h-[18px] shrink-0 cursor-pointer items-center gap-1 rounded-full border border-line bg-transparent px-1.5 font-mono text-[10px] leading-none text-muted hover:border-line-strong hover:text-ink"
					aria-label={`${label} — show schedules`}
				>
					<AlarmClock size={11} />
					{data.schedules.length}
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					className="z-[70] flex w-[330px] max-w-[80vw] flex-col overflow-hidden rounded-lg border-[0.5px] border-line-strong bg-surface shadow-[0_12px_32px_color-mix(in_srgb,var(--ink)_16%,transparent)]"
					align="center"
					sideOffset={8}
				>
					<div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
						<span className="font-sans text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Scheduled</span>
						<span className="min-w-0 flex-1 overflow-hidden text-right font-mono text-[10.5px] text-ellipsis whitespace-nowrap text-muted-soft">{summary}</span>
					</div>
					<ul className="m-0 flex max-h-[300px] list-none flex-col overflow-y-auto p-0">
						{data.schedules.map((item) => {
							const latest = data.runs
								.filter((run) => run.scheduleId === item.id)
								.sort((left, right) => (right.dispatchedAt ?? right.scheduledAt) - (left.dispatchedAt ?? left.scheduledAt))[0];
							const facts = [
								item.nextRunAt !== null ? `next ${clockTime(item.nextRunAt)}` : scheduleStatus(item),
								`${item.runCount} fires`,
								...(latest?.error ? [latest.error] : []),
							]
								.filter((value): value is string => Boolean(value))
								.join(" · ");
							return (
								<li className="flex flex-col gap-[3px] border-b border-line px-3 py-2 last:border-b-0" key={item.id}>
									<span className="font-mono text-[10px] tracking-[0.08em] text-muted uppercase">{item.display}</span>
									<span className="overflow-hidden font-sans text-[12px] text-ellipsis whitespace-nowrap text-ink">{item.title}</span>
									<span className={`overflow-hidden font-mono text-[10.5px] text-ellipsis whitespace-nowrap ${latest?.status === "missed" ? "text-accent-amber" : "text-muted"}`}>
										{facts}
									</span>
								</li>
							);
						})}
					</ul>
					<button
						type="button"
						className="cursor-pointer border-0 border-t border-line bg-transparent px-3 py-1.5 text-left font-sans text-[11px] text-muted hover:bg-hover hover:text-ink"
						onClick={() => void props.host.actions.invoke("schedule.open", data.session)}
					>
						Open details
					</button>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function ScheduleTimeline(props: SlotProps) {
	const data = props.data as { readonly rows: readonly TimelineRow[] } | null;
	if (!data || data.rows.length === 0) return null;

	return (
		<section className="welcome-schedule">
			<div className="welcome-schedule-head">
				<span>Schedule</span>
				<span className="welcome-schedule-count">{data.rows.length} upcoming</span>
			</div>
			<div className="welcome-schedule-list">
				{data.rows.slice(0, WELCOME_MAX_ROWS).map((row, index) => {
					const when = describeNextRun(row.at);
					return (
						<Tip key={`${row.session}:${row.id}`} label={row.title}>
							<button type="button" className={index === 0 ? "welcome-schedule-row is-next" : "welcome-schedule-row"} onClick={() => void props.host.selection.select(row.session)}>
								<span className="welcome-schedule-time">
									{when.day}
									{when.offset !== null ? <sub className="welcome-schedule-offset">+{when.offset}</sub> : null}
									{when.day ? " " : ""}
									{when.clock}
								</span>
								<span className="welcome-schedule-title">{row.title || row.id}</span>
								<span className="welcome-schedule-chat">{row.session}</span>
							</button>
						</Tip>
					);
				})}
			</div>
			{data.rows.length > WELCOME_MAX_ROWS ? <div className="welcome-schedule-more">+{data.rows.length - WELCOME_MAX_ROWS} more</div> : null}
		</section>
	);
}

export function ScheduleDialog(props: DialogProps) {
	const data = props.data as ScheduleData | null;
	const [open, setOpen] = useState<string | null>(null);
	const schedules = data?.schedules ?? [];
	const runs = data?.runs ?? [];
	const bySchedule = (id: string) =>
		runs.filter((run) => run.scheduleId === id).sort((left, right) => (right.dispatchedAt ?? right.scheduledAt) - (left.dispatchedAt ?? left.scheduledAt));
	const last = [...runs].sort((left, right) => (right.dispatchedAt ?? right.scheduledAt) - (left.dispatchedAt ?? left.scheduledAt))[0];
	const active = schedules.filter((item) => item.enabled && item.lifecycleStatus === "active").length;
	const next = schedules
		.filter((item) => item.enabled && item.lifecycleStatus === "active")
		.map((item) => item.nextRunAt)
		.filter((value): value is number => value !== null)
		.sort((left, right) => left - right)[0];
	const summary =
		schedules.length === 0
			? "—"
			: [
					`${active} active`,
					next === undefined ? "nothing scheduled" : `next ${clockTime(next)}`,
					last ? `last ${STATUS_TEXT[last.status]} ${clockTime(last.dispatchedAt ?? last.scheduledAt)}` : null,
				]
					.filter(Boolean)
					.join(" · ");

	return (
		<div className="flex w-[min(640px,calc(100vw-48px))] max-h-[min(80vh,640px)] flex-col overflow-hidden">
			<div className="flex items-baseline gap-3 border-b border-line pt-4 pr-12 pb-3 pl-5">
				<h2 className="m-0 font-sans text-[16px] font-semibold text-ink">Scheduled</h2>
				<span className="min-w-0 overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap text-muted">{summary}</span>
			</div>

			{schedules.length === 0 ? (
				<p className="m-0 px-5 py-7 text-[13px] text-muted">Nothing on the clock yet. Ask in the chat to put work on it.</p>
			) : (
				<div className="min-h-0 overflow-y-auto p-1.5 [&>div+div]:border-t [&>div+div]:border-line-soft">
					{schedules.map((item) => {
						const history = bySchedule(item.id);
						const latest = history[0];
						const facts = [
							item.lifecycleStatus === "active" && item.nextRunAt !== null ? `next · ${clockTime(item.nextRunAt)}` : scheduleStatus(item),
							`${item.runCount} fires`,
							...(latest?.error ? [latest.error] : []),
						]
							.filter((value): value is string => Boolean(value))
							.join(" · ");
						const expanded = open === item.id;
						return (
							<div key={item.id}>
								<button
									type="button"
									className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md bg-transparent px-2.5 py-2 text-left hover:bg-hover"
									aria-expanded={expanded}
									onClick={() => setOpen(expanded ? null : item.id)}
								>
									<span className="font-sans text-[13px] text-ink">{item.title || item.display}</span>
									<span className={`font-mono text-[10px] ${latest?.status === "missed" ? "text-accent-amber" : "text-muted"}`}>{facts}</span>
								</button>
								{expanded ? (
									<div className="px-2.5 pb-2.5">
										<p className="m-0 mb-1.5 text-[12px] leading-[1.6] whitespace-pre-wrap text-ink-soft">{item.payload.text}</p>
										<div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-soft">
											<span>{item.display}</span>
											<span>·</span>
											<span>{scheduleStatus(item)}</span>
										</div>
										{history.length > 0 ? (
											<ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0">
												{history.slice(0, 5).map((run) => (
													<li className="flex gap-2.5 font-mono text-[10px] text-muted" key={run.runId}>
														<span>{clockTime(run.dispatchedAt ?? run.scheduledAt)}</span>
														<span className={run.status === "missed" ? "text-accent-amber" : undefined}>{STATUS_TEXT[run.status]}</span>
														<span className="text-muted-soft">{run.trigger}</span>
														{run.error ? <span className="text-signal">{run.error}</span> : null}
													</li>
												))}
											</ul>
										) : null}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
