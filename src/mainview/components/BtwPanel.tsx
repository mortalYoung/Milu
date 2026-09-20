import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BtwThreadRpc } from "../../shared/rpc";
import { renderMarkdown, renderMarkdownReady } from "../lib/markdown";
import { rpc } from "../lib/rpc";
import { ChatInput } from "./ui/ChatInput";

function BtwMarkdown(props: { text: string; class?: string }) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		el.innerHTML = renderMarkdown(props.text);
		void renderMarkdownReady(props.text).then((html) => {
			if (!cancelled && el.isConnected) el.innerHTML = html;
		});
		return () => {
			cancelled = true;
		};
	}, [props.text]);

	return <div ref={ref} className={props.class} />;
}

export function BtwPanel(props: { name: string; anchorEntryId: string; onClose?: () => void }) {
	const [threads, setThreads] = useState<BtwThreadRpc[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const active = threads.find((t) => t.id === activeId) ?? null;
	const assistantMessages = active?.messages.filter((m) => m.role === "assistant") ?? [];

	useEffect(() => {
		let cancelled = false;
		void rpc.request
			.btw_threads({ name: props.name, anchorEntryId: props.anchorEntryId })
			.then((res) => {
				if (cancelled) return;
				setThreads(res.threads);
				setActiveId((prev) => (prev && res.threads.some((t) => t.id === prev) ? prev : (res.threads.at(-1)?.id ?? null)));
			})
			.catch((e: Error) => {
				if (!cancelled) setError(e.message ?? "load failed");
			});
		return () => {
			cancelled = true;
		};
	}, [props.name, props.anchorEntryId]);

	async function send() {
		const question = draft.trim();
		if (!question || busy) return;
		setDraft("");
		setBusy(true);
		setError(null);
		try {
			const res = await rpc.request.btw_create({ name: props.name, anchorEntryId: props.anchorEntryId, question });
			setThreads((prev) => [...prev.filter((t) => t.id !== res.thread.id), res.thread].sort((a, b) => a.createdAt - b.createdAt));
			setActiveId(res.thread.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setDraft(question);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="btw-panel">
			<div className="btw-kicker">btw</div>
			<div className="btw-composer">
				<ChatInput
					value={draft}
					onValueChange={setDraft}
					onEnter={() => void send()}
					onEscape={() => props.onClose?.()}
					placeholder="ask a side question…"
					variant="annotation"
					autofocus
				>
					<button type="button" className="btw-send" onClick={() => void send()} disabled={busy || !draft.trim()} aria-label="Ask">
						<ArrowUp size={14} />
					</button>
				</ChatInput>
			</div>
			{busy && (
				<div className="btw-flow-loading">
					<span className="work-dot" />
					<span className="work-dot" />
					<span className="work-dot" />
					<span className="btw-loading-label">writing…</span>
				</div>
			)}
			{error && <div className="btw-error">{error}</div>}
			<div className="btw-flow">
				{assistantMessages.map((message, index) => (
					<div className="btw-flow-msg assistant" key={`${activeId}:${index}`}>
						<BtwMarkdown text={message.content} class="btw-flow-content md" />
					</div>
				))}
			</div>
		</div>
	);
}
