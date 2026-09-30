import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useScroll } from "../lib/contexts/scroll-context";
import { useTranscript } from "../lib/contexts/transcript-context";
import type { Entry } from "../lib/entries";
import { formatHistoryTime } from "../lib/entries";

interface ReplyRow {
	question: string;
	questionId: number;
	entry: Entry;
	count: number;
}

const outlineLabel = (text: string) => {
	const first = text.split("\n").find((line) => line.trim() !== "") ?? "";
	return first.length > 42 ? first.slice(0, 42) + "…" : first;
};

export function RepliesPane(props: { open: boolean }) {
	const transcript = useTranscript();
	const scroll = useScroll();
	const items = useStore(transcript.store, (state) => state.items);
	const listEl = useRef<HTMLDivElement>(null);
	const [activeReply, setActiveReply] = useState<number | null>(null);

	const rows = useMemo<ReplyRow[]>(() => {
		const out: ReplyRow[] = [];
		let lastQuestion = "";
		let lastQuestionId = -1;
		let current: ReplyRow | null = null;
		const close = () => {
			if (current) {
				out.push(current);
				current = null;
			}
		};
		for (const entry of items) {
			if (entry.kind === "user") {
				close();
				lastQuestion = entry.text;
				lastQuestionId = entry.id;
			} else if (entry.kind === "agent" && entry.text.trim() !== "") {
				if (!current) current = { question: lastQuestion, questionId: lastQuestionId, entry, count: 1 };
				else {
					current.entry = entry;
					current.count++;
				}
			} else if (entry.kind === "sys" || entry.kind === "sep") {
				close();
			}
		}
		close();
		return out;
	}, [items]);

	useEffect(() => {
		if (listEl.current) listEl.current.scrollTop = listEl.current.scrollHeight;
	}, [props.open, rows]);

	const locate = (row: ReplyRow) => {
		setActiveReply(row.entry.id);
		scroll.locate(row.entry.id);
	};

	return (
		<aside className={"outline" + (!props.open ? " hidden" : "")}>
			<div className="outline-head">
				<span className="eyebrow">Replies</span>
				<span className="outline-count">{rows.length}</span>
			</div>
			<div className="outline-list" ref={listEl}>
				{rows.length === 0 ? (
					<span className="px-3 py-3 font-sans text-[11.5px] text-muted">no replies yet</span>
				) : (
					rows.map((row) => (
						<button type="button" key={row.entry.id} className={"outline-item" + (activeReply === row.entry.id ? " active" : "")} onClick={() => locate(row)}>
							<span className="outline-meta">
								<span className="outline-q">{row.question ? outlineLabel(row.question) : "—"}</span>
								<span className="outline-time">{formatHistoryTime(row.entry.time)}</span>
							</span>
							<span className="outline-a">{outlineLabel(row.entry.text)}</span>
							{row.count > 1 && <span className="outline-stack">stack · {row.count}</span>}
						</button>
					))
				)}
			</div>
		</aside>
	);
}
