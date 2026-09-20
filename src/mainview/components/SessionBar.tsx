import type { MouseEvent } from "react";
import { useStore } from "zustand";
import { useAgentStatus } from "../lib/contexts/agent-status-context";
import { useSession } from "../lib/contexts/session-context";
import { rpc } from "../lib/rpc";
import type { RailTabId } from "./AppRail";

export function SessionBar(props: { view: RailTabId }) {
	const session = useSession();
	const status = useAgentStatus();
	const selected = useStore(session.store, (state) => state.selected);
	const partners = useStore(session.store, (state) => state.partners);
	const writing = useStore(status.store, (state) => state.writing);
	const busy = selected ? (writing[selected] ?? partners.find((p) => p.name === selected)?.writing ?? false) : false;

	const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
		if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [contenteditable='true']")) return;
		void rpc.request.window_zoom_toggle({});
	};

	return (
		<div className="chat-header electrobun-webkit-app-region-drag" onDoubleClick={onDoubleClick}>
			{props.view === "chat" && (
				<div className="chat-worker electrobun-webkit-app-region-no-drag">
					<span>{selected ?? "Chat"}</span>
					{busy && (
						<span className="chat-worker-status" title="Working…">
							<span className="work-dot" />
							<span className="work-dot" />
							<span className="work-dot" />
							Writing…
						</span>
					)}
				</div>
			)}
		</div>
	);
}
