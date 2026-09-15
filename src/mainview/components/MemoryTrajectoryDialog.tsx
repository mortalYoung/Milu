import { createResource, createSignal, For, Show } from "solid-js";
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

function MessageLabel(props: { message: MemoryTrajectoryMessageView }) {
	const message = () => props.message;
	return (
		<>
			<span class="shrink-0 rounded-[3px] border border-hairline px-1 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em] text-body-muted">
				{message().toolName ? `${message().role} · ${message().toolName}` : message().role}
				{message().isError ? " · error" : ""}
				{message().errorMessage ? ` · ${message().stopReason ?? "error"}` : ""}
			</span>
			<span class="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink">{preview(message())}</span>
			<span class={`shrink-0 text-[10px] ${MONO} text-muted`}>{chars(message())}</span>
		</>
	);
}

function Block(props: { label: string; text: string }) {
	return (
		<div class="flex flex-col gap-1">
			<p class="font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">{props.label}</p>
			<pre class="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded border border-hairline bg-paper px-2 py-1.5 font-mono text-[10.5px] leading-[1.55] text-body-muted">
				{props.text}
			</pre>
		</div>
	);
}

export function MemoryTrajectoryDialog(props: { partner: string; run: MemoryRunView | null; onClose: () => void }) {
	const [openMessage, setOpenMessage] = createSignal<string | null>(null);
	const [trace] = createResource(
		() => (props.run ? { name: props.partner, runId: props.run.runId } : null),
		(key) => rpc.request.memory_run_trace(key).then((res) => res.run),
	);

	const counts = () => {
		const events = trace()?.trace ?? [];
		const byType = new Map<string, number>();
		for (const event of events) byType.set(event.event, (byType.get(event.event) ?? 0) + 1);
		return [...byType.entries()];
	};

	return (
		<Dialog open={props.run != null} onOpenChange={(open) => !open && props.onClose()}>
			<DialogContent
				layerClass="z-[60]"
				overlayClass="bg-background/45"
				class="z-[60] w-[1040px] max-w-[min(1040px,92vw)] h-[min(720px,84vh)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-print-line bg-letter text-ink p-0"
			>
				<DialogTitle class="sr-only">Memory run trajectory</DialogTitle>
				<Show when={props.run}>
					{(run) => (
						<>
							<header class="flex flex-col gap-1.5 border-b border-hairline px-5 pb-3 pt-4 pr-12">
								<div class="flex items-baseline gap-2">
									<span class="font-sans text-[13px] font-semibold text-ink">{run().stage} run</span>
									<span class={"font-mono text-[10.5px] " + (run().reason === "completed" ? "text-body-muted" : "text-seal")}>{run().reason}</span>
									<span class="ml-auto font-mono text-[10.5px] text-muted">{convTime(run().startedAt)}</span>
								</div>
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted">
									<span>{(run().durationMs / 1000).toFixed(1)}s</span>
									<span>+{run().added} added</span>
									<Show when={run().usage}>{(usage) => <span title={usageTitle(usage())}>{formatTokens(totalTokens(usage()))} tok</span>}</Show>
									<span>{(run().bytes / 1024).toFixed(1)} KB</span>
									<Show when={trace()?.model}>{(model) => <span>{model()}</span>}</Show>
									<Show when={trace()?.attempts != null}>{(attempts) => <span>{attempts()} attempt(s)</span>}</Show>
									<Show when={trace()?.targetRawId}>{(target) => <span>covered {target().slice(0, 8)}…</span>}</Show>
								</div>
								<Show when={run().error}>
									<p class="font-mono text-[10.5px] text-seal">{run().error}</p>
								</Show>
								<Show when={counts().length > 0}>
									<div class="mt-0.5 flex flex-wrap gap-1.5">
										<For each={counts()}>
											{([type, count]) => (
												<span class="rounded-[3px] border border-hairline px-1.5 py-[1px] font-mono text-[9.5px] text-body-muted">
													{type} × {count}
												</span>
											)}
										</For>
									</div>
								</Show>
							</header>

							<div class="min-h-0 overflow-y-auto px-5 py-3">
								<For each={trace()?.attemptsView ?? []}>
									{(attempt) => (
										<section class="mb-3">
											<p class="mb-1 font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">attempt {attempt.attempt}</p>
											<For each={attempt.messages}>
												{(message, index) => {
													const key = `${attempt.attempt}-${index()}`;
													return (
														<div class="border-b border-hairline last:border-b-0">
															<Show
																when={hasBody(message)}
																fallback={
																	<div class="flex w-full items-baseline gap-2 py-1.5">
																		<MessageLabel message={message} />
																	</div>
																}
															>
																<button
																	type="button"
																	class="memory-row flex w-full items-baseline gap-2 py-1.5 text-left"
																	aria-expanded={openMessage() === key}
																	onClick={() => setOpenMessage(openMessage() === key ? null : key)}
																>
																	<MessageLabel message={message} />
																</button>
															</Show>
															<Show when={openMessage() === key}>
																<div class="flex flex-col gap-2 pb-3 pl-1">
																	<Show when={message.errorMessage}>{(error) => <Block label={`error · ${message.stopReason ?? "error"}`} text={error()} />}</Show>
																	<Show when={message.thinking}>{(thinking) => <Block label="thinking" text={thinking()} />}</Show>
																	<Show when={message.text}>{(text) => <Block label="text" text={text()} />}</Show>
																	<For each={message.toolCalls}>{(call) => <Block label={`tool call · ${call.name}`} text={call.args} />}</For>
																</div>
															</Show>
														</div>
													);
												}}
											</For>
										</section>
									)}
								</For>
							</div>
						</>
					)}
				</Show>
			</DialogContent>
		</Dialog>
	);
}
