import { X } from "lucide-solid";
import { For, Show } from "solid-js";
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
	const queued = () => inbox.list(session.data.selected);
	const partner = () => session.data.selected ?? "";

	return (
		<Show when={queued().length > 0}>
			<div class="followup-dock" role="list" aria-label="Queued messages">
				<div class="followup-dock-head">
					<span class="followup-dock-stamp">PENDING · {queued().length}</span>
				</div>
				<For each={queued()}>
					{(item) => (
						<div class="followup-dock-row" role="listitem">
							<button type="button" class="followup-dock-x" aria-label="Cancel queued message" onClick={() => void inbox.cancel(partner(), item.id)}>
								<X size={12} />
							</button>
							<Show
								when={item.source !== "task"}
								fallback={
									<div class="followup-dock-edit static">
										<span class="followup-dock-task">task</span>
										<p class="followup-dock-text">{item.content}</p>
										<span class="followup-dock-time">{clock(item.timestamp)}</span>
									</div>
								}
							>
								<button
									type="button"
									class="followup-dock-edit"
									title={item.content}
									onClick={() => {
										void inbox.cancel(partner(), item.id);
										composer.prefill(item.content);
									}}
								>
									<p class="followup-dock-text">{item.content}</p>
									{item.failed && <span class="followup-dock-fail">failed</span>}
									<span class="followup-dock-time">{clock(item.timestamp)}</span>
								</button>
							</Show>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}
