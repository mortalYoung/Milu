import { type SurfaceProps } from "@milu/client";
import type { SeqEntry } from "@milu/protocol";
import { useEffect, useRef } from "react";

import { PanelLeftIcon } from "../components/icons.tsx";
import { useStore } from "../use-store.ts";

type Entry = SeqEntry["entry"];

const NO_ENTRIES: readonly SeqEntry[] = [];

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text" ? String((block as { text?: unknown }).text ?? "") : ""))
		.join("");
}

function blockText(entry: Entry): { role: string; text: string } | null {
	if (entry.type !== "message") return null;
	const message = entry.message;
	if (!("content" in message)) return null;
	return { role: message.role, text: textOf(message.content) };
}

function toolLine(entry: Entry): string | null {
	if (entry.type !== "custom" || entry.customType !== "milu/tool") return null;
	const data = (entry.data ?? {}) as { phase?: string; name?: string; isError?: boolean; ms?: number };
	if (data.phase !== "end") return null;
	return `${data.name ?? "?"}${data.ms === undefined ? "" : `  ${data.ms}ms`}${data.isError ? "  ✕" : ""}`;
}

export function ChatPaneSurface(props: SurfaceProps) {
	const { host } = props;
	const state = useStore(host.sessions.state);
	const linked = useStore(host.sessions.linked);
	const listOpen = useStore(host.shell.listOpen);

	const selected = state.selected;
	const entries = state.logs[selected] ?? NO_ENTRIES;
	const running = host.sessions.running(selected);
	const error = state.errors[selected] ?? "";
	const draft = state.drafts[selected] ?? "";

	const scroll = useRef<HTMLDivElement>(null);
	useEffect(() => {
		scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
	}, [entries]);

	const send = () => {
		if (!draft.trim()) return;
		void host.sessions.send(draft);
	};

	const rows = entries.map((entry) => {
		const message = blockText(entry.entry);
		if (message) return { key: `m${entry.seq}`, kind: message.role, text: message.text };
		const tool = toolLine(entry.entry);
		if (tool) return { key: `t${entry.seq}`, kind: "tool", text: tool };
		return null;
	});

	return (
		<main className="chat-area">
			<header className="chat-bar">
				<span className="chat-bar-left">
					{listOpen ? null : (
						<button type="button" className="conv-icon-btn" aria-label="Show chat list" title="Show chat list (⌘B)" onClick={() => host.shell.setList(true)}>
							<PanelLeftIcon size={16} />
						</button>
					)}
					<span className="mono muted">
						{selected || "no chat"} · {entries.length ? `seq ${entries[entries.length - 1]?.seq}` : "empty"}
					</span>
				</span>
				<span className={`dot${running ? " hot" : ""}${linked ? "" : " off"}`} />
			</header>

			<div className="chat-body">
				<div className="transcript" ref={scroll}>
					<div className="chat-column">
						{rows.every((row) => row === null) ? <p className="empty">Send something.</p> : null}
						{rows.map((row) =>
							row ? (
								<div key={row.key} className={`row ${row.kind}`}>
									{row.kind === "tool" ? <span className="mono tool-line">{row.text}</span> : <p>{row.text}</p>}
								</div>
							) : null,
						)}
						{error ? <div className="row error mono">{error}</div> : null}
					</div>
				</div>

				<div className="composer-slot">
					<div className="composer">
						<textarea
							value={draft}
							onChange={(event) => host.sessions.setDraft(selected, event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									send();
								}
							}}
							rows={2}
							placeholder="Message Milu…"
						/>
						<button type="button" onClick={send} disabled={!linked || !draft.trim() || !selected}>
							Send
						</button>
					</div>
				</div>
			</div>
		</main>
	);
}
