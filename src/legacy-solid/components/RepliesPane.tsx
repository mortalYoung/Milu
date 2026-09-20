import { createEffect, createMemo, createSignal, For } from "solid-js";
import { type Entry, formatHistoryTime } from "../layouts/Transcript";
import { useScroll } from "../lib/contexts/scroll-context";
import { useTranscript } from "../lib/contexts/transcript-context";

interface ReplyRow {
	question: string;
	questionId: number;

	entry: Entry;

	count: number;
}

const outlineLabel = (text: string) => {
	const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
	return first.length > 42 ? first.slice(0, 42) + "…" : first;
};

export function RepliesPane(props: { open: boolean }) {
	const transcript = useTranscript();
	const scroll = useScroll();
	const rows = createMemo<ReplyRow[]>(() => {
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
		for (const e of transcript.view()) {
			if (e.kind === "user") {
				close();
				lastQuestion = e.text;
				lastQuestionId = e.id;
			} else if (e.kind === "agent" && e.text.trim() !== "") {
				if (!current) current = { question: lastQuestion, questionId: lastQuestionId, entry: e, count: 1 };
				else {
					current.entry = e;
					current.count++;
				}
			} else if (e.kind === "sys" || e.kind === "sep") {
				close();
			}
		}
		close();
		return out;
	});
	const [activeReply, setActiveReply] = createSignal<number | null>(null);
	let listEl: HTMLDivElement | undefined;

	createEffect(() => {
		props.open;
		rows();
		if (listEl) listEl.scrollTop = listEl.scrollHeight;
	});

	const locate = (row: ReplyRow) => {
		setActiveReply(row.entry.id);
		scroll.locate(row.entry.id);
	};

	return (
		<aside class={`outline ${!props.open && "hidden"}`}>
			<div class="outline-head">
				<span class="eyebrow">Replies</span>
				<span class="outline-count">{rows().length}</span>
			</div>
			<div class="outline-list" ref={listEl}>
				{rows().length === 0 ? (
					<span class="px-3 py-3 font-sans text-[11px] text-body-muted">no replies yet</span>
				) : (
					<For each={rows()}>
						{(r) => (
							<button class={"outline-item" + (activeReply() === r.entry.id ? " active" : "")} onClick={() => locate(r)}>
								<span class="outline-meta">
									<span class="outline-q">{r.question ? outlineLabel(r.question) : "—"}</span>
									<span class="outline-time">{formatHistoryTime(r.entry.time)}</span>
								</span>
								<span class="outline-a">{outlineLabel(r.entry.text)}</span>
								{r.count > 1 && <span class="outline-stack">stack · {r.count}</span>}
							</button>
						)}
					</For>
				)}
			</div>
		</aside>
	);
}
