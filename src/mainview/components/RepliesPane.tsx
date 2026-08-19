/**
 * RepliesPane — the replies index: a floating panel of the agent replies on the
 * right of the chat. Hidden by default; the header outline icon toggles it.
 * One row per agent reply, anchored by the question that triggered it; clicking
 * a row scrolls the transcript to that reply and flashes the bubble.
 */
import { type Accessor, createEffect, createMemo, createSignal, For } from "solid-js";
import type { Entry } from "../layouts/Transcript";

interface ReplyRow {
	entry: Entry;
	question: string;
	questionId: number;
}

/** Single-line label: the first non-empty line, truncated to ~42 chars. */
const outlineLabel = (text: string) => {
	const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
	return first.length > 42 ? first.slice(0, 42) + "…" : first;
};

export function RepliesPane(props: {
	/** Whether the outline is visible (toggled by the header outline icon). */
	open: boolean;
	entries: Accessor<Entry[]>;
	/** Flash the located transcript bubble (shared with the trajectory drawer). */
	onFlash: (id: number) => void;
}) {
	// Each reply carries the question that triggered it, as its anchor
	const replies = createMemo<ReplyRow[]>(() => {
		const out: ReplyRow[] = [];
		let lastQuestion = "";
		let lastQuestionId = -1;
		for (const e of props.entries()) {
			if (e.kind === "user") {
				lastQuestion = e.text;
				lastQuestionId = e.id;
			} else if (e.kind === "agent" && e.text.trim() !== "")
				out.push({
					entry: e,
					question: lastQuestion,
					questionId: lastQuestionId,
				});
		}
		return out;
	});
	const [activeReply, setActiveReply] = createSignal<number | null>(null);
	let listEl: HTMLDivElement | undefined;

	// The panel is mounted only while open: keep the newest reply in view (opens at the bottom).
	// props.open is read so the effect re-runs on every open, not just when the list changes.
	createEffect(() => {
		props.open;
		replies();
		if (listEl) listEl.scrollTop = listEl.scrollHeight;
	});

	// Clicking a row jumps to the reply itself (not the question that triggered it); flash it
	const locate = (replyId: number) => {
		setActiveReply(replyId);
		document.getElementById("entry-" + replyId)?.scrollIntoView({ behavior: "smooth", block: "start" });
		props.onFlash(replyId);
	};

	return (
		<aside class={`outline ${!props.open && "hidden"}`}>
			<div class="outline-head">
				<span class="eyebrow">Replies</span>
				<span class="outline-count">{replies().length}</span>
			</div>
			<div class="outline-list" ref={listEl}>
				{replies().length === 0 ? (
					<span class="px-3 py-3 font-sans text-[11px] text-body-muted">no replies yet</span>
				) : (
					<For each={replies()}>
						{(r) => (
							<button class={"outline-item" + (activeReply() === r.entry.id ? " active" : "")} onClick={() => locate(r.entry.id)}>
								<span class="outline-meta">
									<span class="outline-q">{r.question ? outlineLabel(r.question) : "—"}</span>
									<span class="outline-time">{r.entry.time?.slice(11, 16)}</span>
								</span>
								<span class="outline-a">{outlineLabel(r.entry.text)}</span>
							</button>
						)}
					</For>
				)}
			</div>
		</aside>
	);
}
