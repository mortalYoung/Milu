import type { Host } from "@milu/client";

import { useStore } from "../use-store.ts";
import { PanelLeftOpenIcon } from "./icons.tsx";

export function ChatBar(props: { host: Host }) {
	const { host } = props;
	const state = useStore(host.transcript.state);
	const columns = useStore(host.columns.state);
	const linked = useStore(host.transcript.linked);

	const name = state.selected;
	const running = name !== "" && host.transcript.running(name);

	return (
		<header className="chat-bar">
			<div className="chat-bar-lead">
				{columns.list.mode === "collapsed" ? (
					<button type="button" className="bar-icon" aria-label="Show chat list" title="Show chat list (⌘B)" onClick={() => host.columns.toggleList()}>
						<PanelLeftOpenIcon size={16} />
					</button>
				) : null}
			</div>

			<div className="chat-bar-name">
				<span className="chat-bar-name-text" title={name || undefined}>
					<span>{name || "Chat"}</span>
				</span>
				{running ? (
					<span className="chat-bar-status">
						<span className="work-dot" />
						<span className="work-dot" />
						<span className="work-dot" />
						Writing…
					</span>
				) : null}
			</div>

			<div className="chat-bar-tools">{linked ? null : <span className="dot off" title="Disconnected" />}</div>
		</header>
	);
}
