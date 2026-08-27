/**
 * RepliesPane — the replies index: a floating panel of the agent replies on the
 * right of the chat. Hidden by default; the header outline icon toggles it.
 * The transcript stacks consecutive replies into decks, so one row here represents
 * one deck (burst): the row labels itself with the deck's front card (the newest
 * reply, which is what the stack displays first) and shows a small stack badge
 * when the burst holds more than one reply. Clicking a row scrolls the transcript
 * to the deck and flashes its front card.
 */
import { type Accessor, createEffect, createMemo, createSignal, For } from "solid-js";
import type { Entry } from "../layouts/Transcript";

interface ReplyRow {
	question: string;
	questionId: number;
	/** The deck's front card (the newest reply) — what the stack displays first. */
	entry: Entry;
	/** Replies in this burst; >1 means the transcript renders them as a stack. */
	count: number;
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
	// One row per reply deck: consecutive agent replies (no user/sys/sep between them) group
	// into a burst, mirroring the transcript's MessageStack. Escalations are skipped — they are
	// not replies and they do not split a burst. The row anchors on the question that triggered
	// the burst and labels itself with the deck's front card (the newest reply).
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
		for (const e of props.entries()) {
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

	// The panel is mounted only while open: keep the newest reply in view (opens at the bottom).
	// props.open is read so the effect re-runs on every open, not just when the list changes.
	createEffect(() => {
		props.open;
		rows();
		if (listEl) listEl.scrollTop = listEl.scrollHeight;
	});

	// Clicking a row jumps to the deck's front card (the card the stack displays); flash it
	const locate = (row: ReplyRow) => {
		setActiveReply(row.entry.id);
		document.getElementById("entry-" + row.entry.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
		props.onFlash(row.entry.id);
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
									<span class="outline-time">{r.entry.time?.slice(11, 16)}</span>
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
