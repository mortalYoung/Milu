import { X } from "lucide-react";
import { useStore } from "zustand";
import { useComposer } from "../lib/contexts/composer-context";
import { useInbox } from "../lib/contexts/inbox-context";
import { useSession } from "../lib/contexts/session-context";

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
	const queued = inbox.list(selected);
	const partner = selected ?? "";

	if (queued.length === 0) return null;

	return (
		<div className="followup-dock" role="list" aria-label="Queued Messages">
			<div className="followup-dock-head">
				<span className="followup-dock-tag">PENDING · {queued.length}</span>
			</div>
			{queued.map((item) => (
				<div className="followup-dock-row" role="listitem" key={item.id}>
					<button type="button" className="followup-dock-x" aria-label="Cancel queued message" onClick={() => void inbox.cancel(partner, item.id)}>
						<X size={12} />
					</button>
					{item.source !== "task" ? (
						<button
							type="button"
							className="followup-dock-edit"
							title={item.content}
							onClick={() => {
								void inbox.cancel(partner, item.id);
								composer.prefill(item.content);
							}}
						>
							<p className="followup-dock-text">{item.content}</p>
							{item.failed && <span className="followup-dock-fail">failed</span>}
							<span className="followup-dock-time">{clock(item.timestamp)}</span>
						</button>
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
	);
}
