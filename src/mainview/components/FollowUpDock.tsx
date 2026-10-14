import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useStore } from "zustand";
import { useComposer } from "../lib/contexts/composer-context";
import { useInbox } from "../lib/contexts/inbox-context";
import { useSession } from "../lib/contexts/session-context";
import { Tip } from "./ui/tooltip";

const clock = (ts: number) => {
	const date = new Date(ts);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

export function FollowUpDock() {
	const inbox = useInbox();
	const composer = useComposer();
	const session = useSession();
	const selected = useStore(session.store, (state) => state.selected);
	useStore(inbox.store, (state) => state.queued);
	const [open, setOpen] = useState(true);
	const queued = inbox.list(selected);
	const partner = selected ?? "";

	if (queued.length === 0) return null;

	return (
		<div className="followup-dock">
			<button type="button" className="followup-dock-head" aria-expanded={open} aria-controls="followup-rows" onClick={() => setOpen((value) => !value)}>
				{open ? <ChevronDown size={11} className="followup-dock-caret" /> : <ChevronRight size={11} className="followup-dock-caret" />}
				<span className="followup-dock-tag">
					pending · <span className="followup-dock-count">{queued.length}</span>
				</span>
				<span className="followup-dock-note">{open ? "sent after this run" : "show"}</span>
			</button>
			{open && (
				<div className="followup-dock-rows" id="followup-rows" role="list" aria-label="Queued Messages">
					{queued.map((item) => (
						<div className="followup-dock-row" role="listitem" key={item.id}>
							<button type="button" className="followup-dock-x" aria-label="Cancel queued message" onClick={() => void inbox.cancel(partner, item.id)}>
								<X size={12} />
							</button>
							{item.source !== "task" ? (
								<Tip label={item.content} className="max-w-[320px] leading-snug">
									<button
										type="button"
										className="followup-dock-edit"
										onClick={() => {
											void inbox.cancel(partner, item.id);
											composer.prefill(item.content);
										}}
									>
										<p className="followup-dock-text">{item.content}</p>
										{item.source === "schedule" && <span className="followup-dock-task">scheduled</span>}
										{item.failed && <span className="followup-dock-fail">failed</span>}
										<span className="followup-dock-time">{clock(item.timestamp)}</span>
									</button>
								</Tip>
							) : (
								<div className="followup-dock-edit static">
									<span className="followup-dock-task">task</span>
									<p className="followup-dock-text">{item.content}</p>
									<span className="followup-dock-time">{clock(item.timestamp)}</span>
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
