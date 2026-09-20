import { ArrowUp } from "lucide-solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { BtwThreadRpc } from "../../shared/rpc";
import { renderMarkdown, renderMarkdownReady } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { ChatInput } from "./ui/ChatInput";

function BtwMarkdown(props: { text: string; class?: string }) {
	let ref: HTMLDivElement | undefined;
	createEffect(() => {
		const el = ref;
		if (!el) return;

		let cancelled = false;
		el.innerHTML = renderMarkdown(props.text);
		void renderMarkdownReady(props.text).then((html) => {
			if (!cancelled && el.isConnected) el.innerHTML = html;
		});

		onCleanup(() => {
			cancelled = true;
		});
	});
	return <div ref={ref} class={props.class} />;
}

export function BtwPanel(props: { name: string; anchorEntryId: string; onClose?: () => void }) {
	const [threads, setThreads] = createSignal<BtwThreadRpc[]>([]);
	const [activeId, setActiveId] = createSignal<string | null>(null);
	const [draft, setDraft] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const active = () => threads().find((t) => t.id === activeId()) ?? null;
	const assistantMessages = () => active()?.messages.filter((m) => m.role === "assistant") ?? [];

	createEffect(() => {
		void rpc.request
			.btw_threads({ name: props.name, anchorEntryId: props.anchorEntryId })
			.then((res) => {
				setThreads(res.threads);
				setActiveId((prev) => (prev && res.threads.some((t) => t.id === prev) ? prev : (res.threads.at(-1)?.id ?? null)));
			})
			.catch((e) => setError(e.message ?? "load failed"));
	});

	async function send() {
		const q = draft().trim();
		if (!q || busy()) return;
		setDraft("");
		setBusy(true);
		setError(null);
		try {
			const res = await rpc.request.btw_create({ name: props.name, anchorEntryId: props.anchorEntryId, question: q });
			setThreads((prev) => {
				const next = [...prev.filter((t) => t.id !== res.thread.id), res.thread].sort((a, b) => a.createdAt - b.createdAt);
				return next;
			});
			setActiveId(res.thread.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setDraft(q);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div class="btw-panel">
			<div class="btw-kicker">btw</div>
			<div class="btw-composer">
				<ChatInput
					value={draft()}
					onValueChange={(v) => setDraft(v)}
					onEnter={() => void send()}
					onEscape={() => props.onClose?.()}
					placeholder="ask a side question…"
					variant="annotation"
					autofocus
				>
					<button type="button" class="btw-send" onClick={() => void send()} disabled={busy() || !draft().trim()} aria-label="Ask">
						<ArrowUp size={14} />
					</button>
				</ChatInput>
			</div>
			{busy() && (
				<div class="btw-flow-loading">
					<span class="work-dot" />
					<span class="work-dot" />
					<span class="work-dot" />
					<span class="btw-loading-label">writing…</span>
				</div>
			)}
			<Show when={error()}>
				<div class="btw-error">{error()}</div>
			</Show>
			<div class="btw-flow">
				<For each={assistantMessages()}>
					{(m) => (
						<div class="btw-flow-msg assistant">
							<BtwMarkdown text={m.content} class="btw-flow-content md" />
						</div>
					)}
				</For>
			</div>
		</div>
	);
}
