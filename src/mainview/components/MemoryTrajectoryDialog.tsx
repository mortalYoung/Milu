import { useEffect, useState } from "react";
import type { MemoryRunUsage, MemoryRunView, MemoryTrajectoryMessageView } from "../../shared/rpc";
import { convTime } from "../lib/chat-preview";
import { rpc } from "../lib/rpc";
import { formatTokens } from "../lib/utils";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const MONO = "font-mono tabular-nums";

function totalTokens(usage: MemoryRunUsage): number {
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function usageTitle(usage: MemoryRunUsage): string {
	return `${usage.calls} calls · in ${usage.input} · out ${usage.output} · cache read ${usage.cacheRead} · cache write ${usage.cacheWrite}`;
}

function preview(message: MemoryTrajectoryMessageView): string {
	const text = (message.text ?? message.thinking ?? "").replace(/\s+/g, " ").trim();
	if (text) return text;
	const calls = message.toolCalls?.map((call) => call.name).join(", ");
	return calls ? `${calls}(…)` : "—";
}

function chars(message: MemoryTrajectoryMessageView): string {
	const size = (message.text?.length ?? 0) + (message.thinking?.length ?? 0) + (message.toolCalls?.reduce((acc, call) => acc + call.args.length, 0) ?? 0);
	return size > 0 ? `${size.toLocaleString()} chars` : "";
}

function hasBody(message: MemoryTrajectoryMessageView): boolean {
	return Boolean(message.text || message.thinking || message.toolCalls?.length || message.errorMessage);
}

function MessageLabel({ message }: { message: MemoryTrajectoryMessageView }) {
	return (
		<>
			<span className="shrink-0 rounded-[4px] border border-line px-1 py-[1px] font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
				{message.toolName ? `${message.role} · ${message.toolName}` : message.role}
				{message.isError ? " · error" : ""}
				{message.errorMessage ? ` · ${message.stopReason ?? "error"}` : ""}
			</span>
			<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{preview(message)}</span>
			<span className={`shrink-0 text-[10px] ${MONO} text-muted`}>{chars(message)}</span>
		</>
	);
}

function Block({ label, text }: { label: string; text: string }) {
	return (
		<div className="flex flex-col gap-1">
			<p className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
			<pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[12px] leading-[1.55] text-muted">
				{text}
			</pre>
		</div>
	);
}

export function MemoryTrajectoryDialog(props: { partner: string; run: MemoryRunView | null; onClose: () => void }) {
	const [openMessage, setOpenMessage] = useState<string | null>(null);
	const [lastRun, setLastRun] = useState<MemoryRunView | null>(null);
	/* same as the details dialog: hold the content through the close animation */
	const run = props.run ?? lastRun;
	const [trace, setTrace] = useState<Awaited<ReturnType<typeof rpc.request.memory_run_trace>>["run"] | null>(null);

	useEffect(() => {
		if (run) setLastRun(run);
	}, [props.run]);

	useEffect(() => {
		if (!run) {
			setTrace(null);
			return;
		}
		let cancelled = false;
		const key = { name: props.partner, runId: run.runId };
		void rpc.request.memory_run_trace(key).then((res) => {
			if (!cancelled) setTrace(res.run);
		});
		return () => {
			cancelled = true;
		};
	}, [run, props.partner]);

	const counts = (() => {
		const byType = new Map<string, number>();
		for (const event of trace?.trace ?? []) byType.set(event.event, (byType.get(event.event) ?? 0) + 1);
		return [...byType.entries()];
	})();

	return (
		<Dialog open={props.run != null} onOpenChange={(open) => !open && props.onClose()}>
			<DialogContent
				focusClose
				layerClass="z-[60]"
				overlayClass="bg-scrim"
				className="z-[60] w-[1040px] max-w-[min(1040px,92vw)] h-[min(720px,84vh)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-print-line bg-surface text-ink p-0"
			>
				<DialogTitle className="sr-only">Memory run trajectory</DialogTitle>
				{run && (
					<>
						<header className="flex flex-col gap-1.5 border-b border-line px-5 pb-3 pt-4 pr-12">
							<div className="flex items-baseline gap-2">
								<span className="font-sans text-[14px] font-semibold text-ink">{run.stage} run</span>
								<span className={"font-mono text-[12px] " + (run.reason === "completed" ? "text-muted" : "text-signal")}>{run.reason}</span>
								<span className="ml-auto font-mono text-[12px] text-muted">{convTime(run.startedAt)}</span>
							</div>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted">
								<span>{(run.durationMs / 1000).toFixed(1)}s</span>
								<span>+{run.added} added</span>
								{run.usage && <span title={usageTitle(run.usage)}>{formatTokens(totalTokens(run.usage))} tok</span>}
								<span>{(run.bytes / 1024).toFixed(1)} KB</span>
								{trace?.model && <span>{trace.model}</span>}
								{trace?.attempts != null && <span>{trace.attempts} attempt(s)</span>}
								{trace?.targetRawId && <span>covered {trace.targetRawId.slice(0, 8)}…</span>}
							</div>
							{run.error && <p className="font-mono text-[12px] text-signal">{run.error}</p>}
							{counts.length > 0 && (
								<div className="mt-0.5 flex flex-wrap gap-1.5">
									{counts.map(([type, count]) => (
										<span className="rounded-[4px] border border-line px-1.5 py-[1px] font-mono text-[10px] text-muted" key={type}>
											{type} × {count}
										</span>
									))}
								</div>
							)}
						</header>

						<div className="min-h-0 overflow-y-auto px-5 py-3">
							{(trace?.attemptsView ?? []).map((attempt) => (
								<section className="mb-3" key={attempt.attempt}>
									<p className="mb-1 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">attempt {attempt.attempt}</p>
									{attempt.messages.map((message, index) => {
										const key = `${attempt.attempt}-${index}`;
										const body = hasBody(message);
										return (
											<div className="border-b border-line last:border-b-0" key={key}>
												{body ? (
													<button
														type="button"
														className="memory-row flex w-full items-baseline gap-2 py-1.5 text-left"
														aria-expanded={openMessage === key}
														onClick={() => setOpenMessage(openMessage === key ? null : key)}
													>
														<MessageLabel message={message} />
													</button>
												) : (
													<div className="flex w-full items-baseline gap-2 py-1.5">
														<MessageLabel message={message} />
													</div>
												)}
												{openMessage === key && (
													<div className="flex flex-col gap-2 pb-3 pl-1">
														{message.errorMessage && <Block label={`error · ${message.stopReason ?? "error"}`} text={message.errorMessage} />}
														{message.thinking && <Block label="thinking" text={message.thinking} />}
														{message.text && <Block label="text" text={message.text} />}
														{(message.toolCalls ?? []).map((call, callIndex) => (
															<Block label={`tool call · ${call.name}`} text={call.args} key={`${key}:${callIndex}`} />
														))}
													</div>
												)}
											</div>
										);
									})}
								</section>
							))}
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
