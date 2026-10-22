import * as Popover from "@radix-ui/react-popover";
import { AlarmClock } from "lucide-react";
import { useState } from "react";

import { describeNextRun, type DialogProps, type SlotProps } from "../host/index.ts";
import { Tip } from "../host/tooltip.tsx";

import "./schedule.css";

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

function statusTone(status: RunView["status"]): string {
	return status === "missed" ? " missed" : "";
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
				<button type="button" className="chat-bar-sched" aria-label={`${label} — show schedules`}>
					<AlarmClock size={11} />
					{data.schedules.length}
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content className="sched-pop" align="center" sideOffset={8}>
					<div className="sched-pop-head">
						<span className="sched-pop-eyebrow">Scheduled</span>
						<span className="sched-pop-summary">{summary}</span>
					</div>
					<ul className="sched-pop-rows">
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
								<li className="sched-pop-row" key={item.id}>
									<span className="sched-pop-clock">{item.display}</span>
									<span className="sched-pop-title">{item.title}</span>
									<span className={`sched-pop-facts${latest ? ` is-${latest.status}` : ""}`}>{facts}</span>
								</li>
							);
						})}
					</ul>
					<button type="button" className="sched-pop-more" onClick={() => void props.host.actions.invoke("schedule.open", data.session)}>
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
		<section className="welcome-grp">
			<h3 className="welcome-eyebrow">Next</h3>
			<ul>
				{data.rows.slice(0, WELCOME_MAX_ROWS).map((row) => {
					const when = describeNextRun(row.at);
					return (
						<li className="welcome-row-item" key={`${row.session}:${row.id}`}>
							<Tip label={row.title}>
								<button type="button" className="welcome-row" onClick={() => void props.host.selection.select(row.session)}>
									<span className="welcome-tick" aria-hidden="true" />
									<span className="welcome-when">
										{when.day}
										{when.offset !== null ? <sub className="welcome-offset">+{when.offset}</sub> : null}
										{when.day ? " " : ""}
										{when.clock}
									</span>
									<span className="welcome-what">{row.title || row.id}</span>
									<span className="welcome-chat">{row.session}</span>
								</button>
							</Tip>
						</li>
					);
				})}
				{data.rows.length > WELCOME_MAX_ROWS ? <li className="welcome-more">+{data.rows.length - WELCOME_MAX_ROWS} more</li> : null}
			</ul>
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
		<div className="sched-dialog">
			<div className="sched-head">
				<h2>Scheduled</h2>
				<span className="sched-summary">{summary}</span>
			</div>

			{schedules.length === 0 ? (
				<p className="sched-empty">Nothing on the clock yet. Ask in the chat to put work on it.</p>
			) : (
				<div className="sched-list">
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
							<div className="sched-item" key={item.id}>
								<button type="button" className="sched-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.id)}>
									<span className="sched-title">{item.title || item.display}</span>
									<span className={`sched-facts${latest ? statusTone(latest.status) : ""}`}>{facts}</span>
								</button>
								{expanded ? (
									<div className="sched-detail">
										<p className="sched-prompt">{item.payload.text}</p>
										<div className="sched-meta">
											<span>{item.display}</span>
											<span>·</span>
											<span>{scheduleStatus(item)}</span>
										</div>
										{history.length > 0 ? (
											<ul className="sched-runs">
												{history.slice(0, 5).map((run) => (
													<li key={run.runId}>
														<span>{clockTime(run.dispatchedAt ?? run.scheduledAt)}</span>
														<span className={statusTone(run.status).trim()}>{STATUS_TEXT[run.status]}</span>
														<span className="sched-trigger">{run.trigger}</span>
														{run.error ? <span className="sched-failed">{run.error}</span> : null}
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
