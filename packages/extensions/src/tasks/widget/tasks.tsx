import { composerDataKey, LOG_EVENTS } from "@milu/protocol";
import { useComposerData, useComposerRefresh, type DialogProps, type MarkdownPort, type WidgetProps } from "@milu/window/api";
import { Markdown } from "@milu/window/api/markdown/react";
import { Tip } from "@milu/window/api/tooltip";
import { Terminal } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
	readonly tail: number;
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

function failedOf(task: TaskView): boolean {
	return task.status === "exited" && task.exitCode !== 0;
}

function glyphOf(task: TaskView): string {
	if (task.status === "running") return "●";
	if (task.status === "exited") return failedOf(task) ? "✕" : "✓";
	return "—";
}

function whenOf(task: TaskView, now: number, stopping: boolean): string {
	if (stopping) return "stopping";
	return elapsed(task.startedAt, task.endedAt ?? now);
}

function fenced(text: string, language: string): string {
	const longest = (text.match(/`+/g) ?? []).reduce((most, run) => Math.max(most, run.length), 0);
	const fence = "`".repeat(Math.max(3, longest + 1));
	return `${fence}${language}\n${text}\n${fence}`;
}

function endingOf(task: TaskView): string {
	if (task.status === "killed") return "killed";
	if (task.status === "interrupted") return "interrupted";
	if (task.status !== "exited") return "";
	return task.exitCode === undefined ? "failed" : task.exitCode === 0 ? "" : `exit ${task.exitCode}`;
}

function spokenOf(task: TaskView): string {
	if (task.status === "running") return "running";
	return endingOf(task) || "finished";
}

export function TasksWidget(props: WidgetProps) {
	const { data, session, refresh } = useComposerData<WidgetData | null>(props.host, composerDataKey("composer.left", "tasks"));
	useComposerRefresh(props.host, session, refresh, (entry) => entry.type === "custom" && (entry.customType === LOG_EVENTS.taskStart || entry.customType === LOG_EVENTS.taskEnd));
	if (!data) return null;
	const label = data.running > 0 ? `Tasks · ${data.running} running` : "Tasks";
	return (
		<span className="relative inline-flex">
			<Tip label={label}>
				<button type="button" className="composer-icon-btn" aria-label={label} onClick={() => void props.host.actions.invoke("tasks.open", data.session)}>
					<Terminal size={15} />
				</button>
			</Tip>
			{data.running > 0 ? (
				<span className="pointer-events-none absolute top-0 right-0 grid h-[13px] min-w-[13px] place-items-center rounded-full bg-accent-teal/20 px-[3px] font-mono text-[8px] leading-none font-semibold text-accent-teal tabular-nums">
					{data.running}
				</span>
			) : null}
		</span>
	);
}

function TaskRow(props: {
	task: TaskView;
	tail: number;
	port: MarkdownPort;
	now: number;
	open: boolean;
	stopping: boolean;
	index: number;
	onToggle: () => void;
	onStop: () => void;
}) {
	const tone = props.task.status === "running" ? "text-muted tabular-nums" : "text-muted-soft tabular-nums";
	const silent = props.task.text.trim() === "";
	const log = useRef<HTMLDivElement>(null);
	const pinned = useRef(true);
	const title = useRef<HTMLSpanElement>(null);
	const [cut, setCut] = useState(false);

	useLayoutEffect(() => {
		const element = title.current;
		setCut(element !== null && element.scrollWidth > element.clientWidth + 1);
	}, [props.task.command]);

	useLayoutEffect(() => {
		pinned.current = true;
	}, [props.open]);

	useLayoutEffect(() => {
		const element = log.current;
		if (element && pinned.current) element.scrollTop = element.scrollHeight;
	}, [props.open, props.task.text]);

	return (
		<div className="animate-[tasks-row-in_220ms_var(--ease-out)_both] motion-reduce:animate-none" style={{ animationDelay: `${Math.min(props.index, 8) * 22}ms` }}>
			<div className={`flex items-center gap-1 rounded-[6px] transition-colors duration-[120ms] ${props.open ? "bg-selected" : "hover:bg-hover"}`}>
				<button
					type="button"
					aria-expanded={props.open}
					className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2.5 border-0 bg-transparent px-3 py-2 text-left"
					onClick={props.onToggle}
				>
					<span
						aria-hidden
						className={`w-[10px] shrink-0 font-mono text-[10px] leading-none ${
							props.task.status === "running" && !props.stopping
								? "animate-[tasks-live-pulse_1.9s_cubic-bezier(0.23,1,0.32,1)_infinite] text-accent-teal motion-reduce:animate-none"
								: props.stopping
									? "text-muted"
									: failedOf(props.task)
										? "text-signal"
										: "text-muted-soft"
						}`}
					>
						{glyphOf(props.task)}
					</span>
					<span className="sr-only">{spokenOf(props.task)}</span>
					<span ref={title} className={`min-w-0 flex-1 truncate font-mono text-[12px] ${props.open ? "text-ink" : "text-ink-soft"}`}>
						{props.task.command}
					</span>
					<span className={`shrink-0 font-mono text-[10px] ${tone}`}>{whenOf(props.task, props.now, props.stopping)}</span>
				</button>
				{props.task.status === "running" ? (
					<button
						type="button"
						disabled={props.stopping}
						className="mr-2 h-[22px] shrink-0 cursor-pointer rounded-[4px] border border-line bg-transparent px-2 font-mono text-[10px] leading-none tracking-[0.08em] text-ink-soft transition-colors duration-[120ms] hover:border-signal hover:bg-hover hover:text-signal disabled:cursor-default disabled:opacity-45 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-ink-soft"
						onClick={props.onStop}
					>
						STOP
					</button>
				) : null}
			</div>
			{props.open ? (
				<div className="pr-3 pb-2.5 pl-[32px]">
					{cut ? (
						<div className="task-command mb-1.5 min-w-0">
							<Markdown port={props.port} text={fenced(`$ ${props.task.command}`, "console")} />
						</div>
					) : null}
					<div
						ref={log}
						onScroll={() => {
							const element = log.current;
							if (element) pinned.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 16;
						}}
						className="task-log max-h-[min(42vh,300px)] overflow-auto rounded-[6px] border border-line-soft bg-canvas px-3 py-2"
					>
						{silent ? (
							<p className="m-0 font-mono text-[11.5px] leading-[1.7] text-muted-soft">{props.task.status === "running" ? "(no output yet)" : "(no output)"}</p>
						) : (
							<Markdown port={props.port} text={fenced(props.task.text, "log")} />
						)}
					</div>
					<div className="mt-1.5 flex items-baseline gap-3 font-mono text-[10px] text-muted-soft">
						{endingOf(props.task) === "" ? null : <span>{endingOf(props.task)}</span>}
						<span>{formatBytes(props.task.bytes)}</span>
						<span className="ml-auto">last {props.tail} lines</span>
					</div>
				</div>
			) : null}
		</div>
	);
}

const POLL_MS = 1500;

export function TasksDialog(props: DialogProps) {
	const [data, setData] = useState<TasksData | null>(() => props.data as TasksData | null);
	const [open, setOpen] = useState<string | null>(null);
	const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set());
	const [stopped, setStopped] = useState<ReadonlyMap<string, number>>(() => new Map());
	const [now, setNow] = useState(() => Date.now());
	const rows = [...(data?.tasks ?? [])].sort((left, right) => right.startedAt - left.startedAt);
	const tasks = rows.map((task) => {
		const at = stopped.get(task.id);
		return at === undefined ? task : { ...task, status: "killed" as const, endedAt: at };
	});
	const opened = open ?? tasks[0]?.id ?? null;

	const running = tasks.filter((task) => task.status === "running").length;
	const failed = tasks.filter(failedOf).length;
	const ticking = tasks.some((task) => task.status === "running" && !stopping.has(task.id));

	useEffect(() => {
		if (!ticking) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [ticking]);

	const refresh = useCallback(async () => {
		const session = data?.session;
		if (session === undefined) return;
		const next = await props.host.actions.request<TasksData>("tasks.collect", session).catch(() => undefined);
		if (!next) return;
		const alive = new Set(next.tasks.filter((task) => task.status === "running").map((task) => task.id));
		setData(next);
		setStopping((current) => {
			const kept = new Set([...current].filter((id) => alive.has(id)));
			return kept.size === current.size ? current : kept;
		});
		setStopped((current) => {
			const kept = new Map([...current].filter(([id]) => alive.has(id)));
			return kept.size === current.size ? current : kept;
		});
	}, [data?.session, props.host]);

	const ready = data !== null;
	useEffect(() => {
		if (!ready) return;
		const timer = window.setInterval(() => void refresh(), POLL_MS);
		return () => window.clearInterval(timer);
	}, [ready, refresh]);

	const stop = (id: string): void => {
		if (!data) return;
		setStopping((current) => new Set(current).add(id));
		void props.host.actions
			.invoke("tasks.stop", data.session, { id })
			.then(() => setStopped((current) => new Map(current).set(id, Date.now())))
			.catch(() =>
				setStopping((current) => {
					const next = new Set(current);
					next.delete(id);
					return next;
				}),
			);
	};

	const summary = [`${running} running`, ...(failed > 0 ? [`${failed} failed`] : [])].join(" · ");

	return (
		<div className="flex max-h-[min(80vh,680px)] w-[min(720px,calc(100vw-48px))] flex-col overflow-hidden">
			<header className="flex items-baseline gap-3 border-b border-line pt-4 pr-12 pb-3 pl-5">
				<h2 className="m-0 font-serif text-[18px] font-semibold tracking-[-0.01em] text-ink">Tasks</h2>
				{tasks.length > 0 ? <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">{summary}</span> : null}
			</header>

			{tasks.length === 0 ? (
				<div className="flex flex-col gap-2 px-5 py-10">
					<p className="m-0 font-serif text-[15px] text-ink">Nothing in the background.</p>
					<p className="m-0 font-mono text-[10.5px] leading-[1.7] text-muted">
						A bash call with <span className="text-ink-soft">background: true</span> starts one and returns its id.
					</p>
				</div>
			) : (
				<div className="min-h-0 overflow-y-auto p-1.5">
					{tasks.map((task, index) => (
						<TaskRow
							key={task.id}
							task={task}
							tail={data?.tail ?? 0}
							port={props.host.markdown}
							now={now}
							index={index}
							open={opened === task.id}
							stopping={stopping.has(task.id)}
							onToggle={() => setOpen(opened === task.id ? null : task.id)}
							onStop={() => stop(task.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
