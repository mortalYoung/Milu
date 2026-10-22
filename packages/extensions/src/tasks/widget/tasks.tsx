import { Terminal } from "lucide-react";
import { useState } from "react";

import type { DialogProps, WidgetProps } from "../../host/index.ts";
import { Tip } from "../../host/tooltip.tsx";

interface TaskView {
	readonly id: string;
	readonly command: string;
	readonly status: "running" | "exited" | "killed" | "interrupted";
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly exitCode?: number;
	readonly bytes: number;
	readonly text: string;
}

interface TasksData {
	readonly session: string;
	readonly tasks: readonly TaskView[];
}

interface WidgetData {
	readonly session: string;
	readonly running: number;
	readonly total: number;
}

function elapsed(from: number, to: number): string {
	const seconds = Math.max(0, Math.round((to - from) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatBytes(value: number): string {
	if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${value} B`;
}

function glyphOf(task: TaskView): string {
	if (task.status === "running") return "●";
	if (task.status === "exited") return task.exitCode ? "✕" : "✓";
	return "—";
}

function detailOf(task: TaskView, now: number): string {
	if (task.status === "running") return `running · ${elapsed(task.startedAt, now)}`;
	const took = task.endedAt === undefined ? "" : ` · ${elapsed(task.startedAt, task.endedAt)}`;
	if (task.status === "killed") return `killed${took}`;
	if (task.status === "interrupted") return `interrupted${took}`;
	return `exit ${task.exitCode ?? "?"}${took}`;
}

export function TasksWidget(props: WidgetProps) {
	const data = props.data as WidgetData | null;
	if (!data) return null;
	return (
		<span className="relative inline-flex">
			<Tip label="Tasks">
				<button type="button" className="composer-icon-btn" aria-label="Tasks" onClick={() => void props.host.actions.invoke("tasks.open", data.session)}>
					<Terminal size={15} />
				</button>
			</Tip>
			{data.running > 0 ? (
				<span className="pointer-events-none absolute -top-[3px] -right-[3px] grid h-[13px] min-w-[13px] place-items-center rounded-[6px] bg-signal px-[3px] font-mono text-[10px] font-semibold text-surface">
					{data.running}
				</span>
			) : null}
		</span>
	);
}

export function TasksDialog(props: DialogProps) {
	const data = props.data as TasksData | null;
	const tasks = data?.tasks ?? [];
	const [selected, setSelected] = useState<string | null>(tasks.at(-1)?.id ?? null);
	const current = tasks.find((task) => task.id === selected) ?? null;
	const [now] = useState(() => Date.now());
	const running = tasks.filter((task) => task.status === "running").length;
	const failed = tasks.filter((task) => task.status === "exited" && task.exitCode).length;

	const stop = async (): Promise<void> => {
		if (!data || !current) return;
		await props.host.actions.invoke("tasks.stop", data.session, { id: current.id });
		props.close(null);
	};

	return (
		<div className="flex max-h-[min(80vh,720px)] w-[min(880px,calc(100vw-48px))] flex-col overflow-hidden">
			<div className="flex items-baseline gap-3 border-b border-line pt-4 pr-12 pb-3 pl-5">
				<h2 className="m-0 font-sans text-[16px] font-semibold text-ink">Tasks</h2>
				<span className="font-mono text-[10px] text-muted">
					{running} running
					{failed > 0 ? <span className="text-signal"> · {failed} failed</span> : null}
				</span>
			</div>

			{tasks.length === 0 ? (
				<p className="m-0 px-5 py-8 font-sans text-[13px] text-muted">No background tasks yet.</p>
			) : (
				<div className="grid h-[min(56vh,440px)] min-h-0 grid-cols-[186px_minmax(0,1fr)]">
					<div className="min-h-0 overflow-y-auto border-r border-line p-1.5">
						{tasks.map((task: TaskView) => {
							const live = task.status === "running";
							const broken = task.status === "exited" && Boolean(task.exitCode);
							const on = task.id === selected;
							return (
								<button
									type="button"
									key={task.id}
									className={`block w-full cursor-pointer rounded-md border-0 px-2 py-1.5 text-left transition-colors duration-[120ms] ${on ? "bg-selected" : "bg-transparent hover:bg-hover"}`}
									onClick={() => setSelected(task.id)}
								>
									<span className="flex items-center gap-1.5">
										<span
											className={`shrink-0 font-mono text-[10px] ${
												live
													? "animate-[tasks-live-pulse_1.9s_cubic-bezier(0.23,1,0.32,1)_infinite] text-accent-teal motion-reduce:animate-none"
													: broken
														? "text-signal"
														: "text-muted"
											}`}
										>
											{glyphOf(task)}
										</span>
										<span className={`min-w-0 overflow-hidden font-mono text-[12px] text-ellipsis whitespace-nowrap ${on ? "font-semibold text-ink" : "text-ink-soft"}`}>
											{task.command}
										</span>
									</span>
									<span className={`mt-0.5 block pl-[18px] font-mono text-[10px] ${broken ? "text-signal" : "text-muted"}`}>{detailOf(task, now)}</span>
								</button>
							);
						})}
					</div>

					<div className="flex min-h-0 flex-col">
						<pre className="m-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.7] whitespace-pre text-ink-soft">
							{current?.text.trim() ? current.text : current ? "(no output yet)" : "—"}
						</pre>
						<div className="flex items-baseline justify-between gap-3 border-t border-line px-3 py-1.5 font-mono text-[10px] text-muted">
							<span>{current ? `${detailOf(current, now)} · ${formatBytes(current.bytes)}` : "—"}</span>
							{current?.status === "running" ? (
								<button type="button" className="cursor-pointer border-0 bg-transparent font-mono text-[10px] text-muted hover:text-ink" onClick={() => void stop()}>
									stop
								</button>
							) : null}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
