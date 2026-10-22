import { Terminal } from "lucide-react";
import { useState } from "react";

import type { DialogProps, WidgetProps } from "../host/index.ts";
import { Tip } from "../host/tooltip.tsx";

import "./tasks.css";

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

function toneOf(task: TaskView): string {
	if (task.status === "running") return " live";
	if (task.status === "exited" && task.exitCode) return " failed";
	return "";
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
		<span className="tasks-slot">
			<Tip label="Tasks">
				<button type="button" className="composer-icon-btn" aria-label="Tasks" onClick={() => void props.host.actions.invoke("tasks.open", data.session)}>
					<Terminal size={15} />
				</button>
			</Tip>
			{data.running > 0 ? <span className="tasks-count">{data.running}</span> : null}
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
		<div className="tasks-dialog">
			<div className="tasks-head">
				<h2>Tasks</h2>
				<span className="tasks-meta">
					{running} running
					{failed > 0 ? <span className="tasks-failed"> · {failed} failed</span> : null}
				</span>
			</div>

			{tasks.length === 0 ? (
				<p className="tasks-empty">No background tasks yet.</p>
			) : (
				<div className="tasks-grid">
					<div className="tasks-list">
						{tasks.map((task) => (
							<button type="button" key={task.id} className={`tasks-row${task.id === selected ? " is-on" : ""}`} onClick={() => setSelected(task.id)}>
								<span className="tasks-row-head">
									<span className={`tasks-glyph${toneOf(task)}`}>{glyphOf(task)}</span>
									<span className="tasks-command">{task.command}</span>
								</span>
								<span className={`tasks-detail${toneOf(task)}`}>{detailOf(task, now)}</span>
							</button>
						))}
					</div>

					<div className="tasks-pane">
						<pre className="tasks-log">{current?.text.trim() ? current.text : current ? "(no output yet)" : "—"}</pre>
						<div className="tasks-foot">
							<span>{current ? `${detailOf(current, now)} · ${formatBytes(current.bytes)}` : "—"}</span>
							{current?.status === "running" ? (
								<button type="button" className="tasks-stop" onClick={() => void stop()}>
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
