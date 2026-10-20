import type { Host } from "@milu/extensions/host";
import { SLOT_POINTS } from "@milu/protocol";
import { useStore } from "zustand";

import { PanelLeftOpenIcon } from "./icons.tsx";

const NO_ITEMS: readonly never[] = [];

export function ChatBar(props: { host: Host }) {
	const { host } = props;
	const columns = useStore(host.columns.store, (state) => state.columns);
	const linked = useStore(host.connection.store, (state) => state.linked);
	const items = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatBar] ?? NO_ITEMS);

	const name = useStore(host.selection.store, (state) => state.selected);
	const running = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === name)?.running ?? false);

	return (
		<header className={columns.list.mode === "flow" ? "chat-bar" : "chat-bar at-edge"}>
			<div className="chat-bar-lead">
				{columns.list.mode === "collapsed" ? (
					<button type="button" className="bar-icon list-expand" aria-label="Show chat list" title="Show chat list (⌘B)" onClick={() => host.columns.toggleList()}>
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

			<div className="chat-bar-tools">
				{items.map((item) => {
					const Component = host.slots.component(item.component);
					return Component ? <Component key={item.id} host={host} /> : null;
				})}
				{linked ? null : <span className="dot off" title="Disconnected" />}
			</div>
		</header>
	);
}
