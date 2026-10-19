import { type SurfaceProps } from "@milu/client";
import type { SeqEntry } from "@milu/protocol";
import { useEffect, useRef } from "react";

import { ChatBar } from "../components/chat-bar.tsx";
import { Composer } from "../components/composer.tsx";
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

export function TranscriptPaneSurface(props: SurfaceProps) {
	const { host } = props;
	const state = useStore(host.transcript.state);

	const selected = state.selected;
	const entries = state.logs[selected] ?? NO_ENTRIES;
	const error = state.errors[selected] ?? "";

	const scroll = useRef<HTMLDivElement>(null);
	useEffect(() => {
		scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
	}, [entries]);

	const hasMore = state.hasMore[selected] ?? false;
	const loadingOlder = state.loadingOlder[selected] ?? false;
	const loadOlder = () => {
		const element = scroll.current;
		const before = element?.scrollHeight ?? 0;
		void host.transcript.loadOlder(selected).then(() => {
			if (!element) return;
			element.scrollTop += element.scrollHeight - before;
		});
	};

	const rows = entries.flatMap((entry) => {
		const message = blockText(entry.entry);
		if (message) return message.text.trim() ? [{ key: `m${entry.seq}`, kind: message.role, text: message.text }] : [];
		const tool = toolLine(entry.entry);
		if (tool) return [{ key: `t${entry.seq}`, kind: "tool", text: tool }];
		return [];
	});

	return (
		<div className="transcript-pane">
			<ChatBar host={host} />

			<div className="chat-body">
				<div className="chat-column">
					<div className="transcript" ref={scroll}>
						{hasMore ? (
							<div className="load-earlier-wrap">
								<button type="button" className="load-earlier" onClick={loadOlder} disabled={loadingOlder}>
									{loadingOlder ? "loading…" : "↑ load earlier"}
								</button>
							</div>
						) : null}
						{rows.length === 0 ? <p className="empty">Send something.</p> : null}
						{rows.map((row) => (
							<div key={row.key} className={`row ${row.kind}`}>
								{row.kind === "tool" ? <span className="mono tool-line">{row.text}</span> : <p>{row.text}</p>}
							</div>
						))}
						{error ? <div className="row error mono">{error}</div> : null}
					</div>

					<div className="composer-slot">
						<Composer host={host} />
					</div>
				</div>
			</div>
		</div>
	);
}
