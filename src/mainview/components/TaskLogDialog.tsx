import { useEffect, useRef, useState } from "react";
import type { TaskStatus } from "../../shared/events";
import type { TaskSummary } from "../../shared/rpc";
import { rpc } from "../lib/rpc";
import { classifyReader, distanceToBottom, floorTop, isAtBottom } from "../lib/scroll-anchor";
import { formatBytes } from "../lib/utils";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const ROW = "w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink/5";
const ROW_ON = "bg-ink/10";

function elapsed(from: number, to: number): string {
	const seconds = Math.max(0, Math.round((to - from) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function glyphOf(status: TaskStatus, exitCode: number | undefined): string {
	if (status === "running") return "●";
	if (status === "exited") return exitCode ? "✕" : "✓";
	return "—";
}

function glyphClass(status: TaskStatus, exitCode: number | undefined): string {
	if (status === "running") return "task-live";
	if (status === "exited" && exitCode) return "text-seal";
	return "text-muted";
}

function detailOf(task: TaskSummary, now: number): string {
	if (task.status === "running") return `running · ${elapsed(task.startedAt, now)}`;
	const took = task.endedAt !== undefined ? ` · ${elapsed(task.startedAt, task.endedAt)}` : "";
	if (task.status === "killed") return `killed${took}`;
	if (task.status === "interrupted") return `interrupted${took}`;
	return `exit ${task.exitCode ?? "?"}${took}`;
}

type Match = { line: number; text: string };

export function TaskLogDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; tasks: TaskSummary[]; partner: string | null; version: number; output: number }) {
	const [selected, setSelected] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [bytes, setBytes] = useState(0);
	const [loading, setLoading] = useState(false);
	const [paging, setPaging] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [following, setFollowing] = useState(true);
	const [now, setNow] = useState(() => Date.now());
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<{ total: number; matches: Match[]; truncated: boolean } | null>(null);
	const [searching, setSearching] = useState(false);

	const searchSeq = useRef(0);
	const logRef = useRef<HTMLDivElement>(null);
	const observedTop = useRef(0);
	const pinRaf = useRef<number | null>(null);
	const cursor = useRef(0);
	const topOffset = useRef(0);
	const loaded = useRef<string | null>(null);
	const seq = useRef(0);
	const followingRef = useRef(following);
	followingRef.current = following;

	function onLogScroll() {
		const el = logRef.current;
		if (!el) return;
		const floor = floorTop(el.scrollHeight, el.clientHeight);
		if (!classifyReader(el.scrollTop, observedTop.current, floor)) return;
		setFollowing(isAtBottom(distanceToBottom(el.scrollHeight, el.scrollTop, el.clientHeight)));
	}

	function pin() {
		if (pinRaf.current != null) cancelAnimationFrame(pinRaf.current);
		pinRaf.current = requestAnimationFrame(() => {
			pinRaf.current = null;
			const el = logRef.current;
			if (!el || !followingRef.current) return;
			el.scrollTop = el.scrollHeight;
			observedTop.current = el.scrollTop;
		});
	}

	useEffect(
		() => () => {
			if (pinRaf.current != null) cancelAnimationFrame(pinRaf.current);
		},
		[],
	);

	const current = props.tasks.find((task) => task.id === selected) ?? null;

	async function load(id: string, reset: boolean): Promise<void> {
		const token = ++seq.current;
		setLoading(true);
		try {
			const response = reset
				? await rpc.request.task_read({ name: props.partner ?? "", id })
				: await rpc.request.task_read({ name: props.partner ?? "", id, offset: cursor.current });
			if (token !== seq.current) return;
			if (!response.ok) return;
			cursor.current = response.nextOffset ?? cursor.current;
			setBytes(response.bytes ?? 0);
			if (reset || response.reset) {
				setText(response.text ?? "");
				topOffset.current = response.startOffset ?? 0;
				setHasMore(response.hasMore ?? false);
			} else if (response.text) {
				setText((previous) => previous + response.text);
			}
		} finally {
			if (token === seq.current) setLoading(false);
		}
	}

	async function loadEarlier(): Promise<void> {
		const el = logRef.current;
		const id = selected;
		if (!el || !id || paging || !hasMore) return;
		setPaging(true);
		try {
			const height = el.scrollHeight;
			const response = await rpc.request.task_read({ name: props.partner ?? "", id, before: topOffset.current });
			if (!response.ok || !response.text) {
				setHasMore(false);
				return;
			}
			setText((previous) => (previous ? `${response.text}\n${previous}` : (response.text ?? "")));
			topOffset.current = response.startOffset ?? 0;
			setHasMore(response.hasMore ?? false);
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			el.scrollTop += el.scrollHeight - height;
			observedTop.current = el.scrollTop;
		} finally {
			setPaging(false);
		}
	}

	useEffect(() => {
		if (props.open) return;
		setSelected(null);
		setText("");
		setBytes(0);
		setHasMore(false);
		cursor.current = 0;
		topOffset.current = 0;
		loaded.current = null;
	}, [props.open]);

	useEffect(() => {
		if (!props.open) return;
		const list = props.tasks;
		if (selected && list.some((task) => task.id === selected)) return;
		setSelected((list.find((task) => task.status === "running") ?? list[0])?.id ?? null);
	}, [props.open, props.tasks, selected]);

	useEffect(() => {
		if (!props.open) return;
		const id = selected;
		if (!id) return;
		const reset = id !== loaded.current;
		loaded.current = id;
		void load(id, reset);
	}, [props.open, selected, props.version]);

	useEffect(() => {
		if (!props.open) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [props.open]);

	useEffect(() => {
		const id = selected;
		const partner = props.partner;
		const needle = query.trim();
		if (!id || !partner || !needle) {
			setResults(null);
			setSearching(false);
			return;
		}
		const token = ++searchSeq.current;
		setSearching(true);
		const timer = setTimeout(() => {
			void rpc.request.task_search({ name: partner, id, query: needle }).then((response) => {
				if (token !== searchSeq.current) return;
				setResults(response.ok ? { total: response.total ?? 0, matches: response.matches ?? [], truncated: response.truncated ?? false } : null);
				setSearching(false);
			});
		}, 140);
		return () => clearTimeout(timer);
	}, [selected, props.partner, query]);

	useEffect(() => {
		if (!following) return;
		pin();
	}, [text, following, props.output]);

	const running = props.tasks.filter((task) => task.status === "running").length;
	const searchMode = query.trim().length > 0;
	const failed = props.tasks.filter((task) => task.status === "exited" && task.exitCode).length;

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent focusClose className="w-[880px] max-w-[880px] bg-paper text-ink p-0 gap-0 overflow-hidden">
				<DialogTitle className="sr-only">Tasks</DialogTitle>
				<div className="flex w-full max-h-[min(80vh,720px)] flex-col overflow-hidden">
					<div className="flex shrink-0 items-baseline gap-3 border-b border-hairline px-5 pt-4 pb-3 pr-12">
						<h2 className="font-sans text-[15px] font-semibold leading-tight text-ink">Tasks</h2>
						<span className="font-mono text-[10px] text-body-muted">
							{running} running
							{failed > 0 && (
								<>
									{" "}
									· <span className="text-seal">{failed} failed</span>
								</>
							)}
						</span>
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
							placeholder="Search the whole log"
							aria-label="Search the whole log"
							className="ml-auto w-[210px] rounded-[6px] border border-hairline bg-paper px-2 py-1 font-mono text-[10.5px] text-ink placeholder:text-muted focus:border-ink-soft focus:outline-none"
						/>
					</div>

					{props.tasks.length === 0 ? (
						<p className="px-5 py-8 font-sans text-[12.5px] text-body-muted">No background tasks yet.</p>
					) : (
						<div className="grid h-[min(56vh,440px)] grid-cols-[186px_minmax(0,1fr)] max-[720px]:h-[min(64vh,520px)] max-[720px]:grid-cols-1">
							<div className="min-h-0 overflow-y-auto border-r border-hairline p-1.5 max-[720px]:max-h-[132px] max-[720px]:border-r-0 max-[720px]:border-b">
								{props.tasks.map((task) => (
									<button type="button" key={task.id} className={`${ROW} ${task.id === selected ? ROW_ON : ""}`} onClick={() => setSelected(task.id)}>
										<span className="flex items-center gap-1.5">
											<span className={`shrink-0 font-mono text-[10px] ${glyphClass(task.status, task.exitCode)}`}>{glyphOf(task.status, task.exitCode)}</span>
											<span className={`min-w-0 truncate font-mono text-[10.5px] ${task.id === selected ? "font-semibold text-ink" : "text-ink-soft"}`}>{task.command}</span>
										</span>
										<span className={`mt-0.5 block pl-[18px] font-mono text-[9px] ${task.status === "exited" && task.exitCode ? "text-seal" : "text-body-muted"}`}>
											{detailOf(task, now)}
										</span>
									</button>
								))}
							</div>

							<div className="flex min-h-0 flex-col bg-letter">
								{!searchMode && (
									<div ref={logRef} onScroll={onLogScroll} className="min-h-0 flex-1 overflow-auto">
										{hasMore && (
											<button
												type="button"
												disabled={paging}
												onClick={() => void loadEarlier()}
												className="sticky top-0 z-10 w-full border-b border-hairline-soft bg-letter px-3 py-1 text-left font-mono text-[9.5px] text-body-muted hover:text-ink disabled:opacity-60"
											>
												{paging ? "loading…" : "Load earlier"}
											</button>
										)}
										<pre className="whitespace-pre px-3 py-2 font-mono text-[11px] leading-[1.7] text-ink-soft">{text || (loading ? "loading…" : "(no output yet)")}</pre>
									</div>
								)}
								{searchMode && (
									<div className="min-h-0 flex-1 overflow-auto">
										{results?.matches.length ? (
											results.matches.map((match) => (
												<div className="flex items-baseline gap-2 border-b border-hairline-soft px-3 py-1" key={`${match.line}:${match.text}`}>
													<span className="w-[44px] shrink-0 text-right font-mono text-[9.5px] text-muted">{match.line}</span>
													<span className="min-w-0 truncate whitespace-pre font-mono text-[11px] text-ink-soft" title={match.text}>
														{match.text}
													</span>
												</div>
											))
										) : (
											<p className="px-3 py-3 font-mono text-[10.5px] text-body-muted">{searching ? "searching…" : "no matches"}</p>
										)}
									</div>
								)}
								<div className="flex shrink-0 items-baseline justify-between gap-3 border-t border-hairline px-3 py-1.5">
									<span className="font-mono text-[9.5px] text-body-muted">
										{searchMode
											? results
												? `${results.total} match${results.total === 1 ? "" : "es"}${results.truncated ? ` · first ${results.matches.length}` : ""}`
												: "searching…"
											: current
												? `${detailOf(current, now)} · ${formatBytes(bytes)}`
												: "—"}
									</span>
									{current?.status === "running" && (
										<button
											type="button"
											className="font-mono text-[9.5px] text-body-muted hover:text-ink"
											onClick={() => void rpc.request.task_stop({ name: props.partner ?? "", id: selected ?? "" })}
										>
											stop
										</button>
									)}
								</div>
							</div>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
