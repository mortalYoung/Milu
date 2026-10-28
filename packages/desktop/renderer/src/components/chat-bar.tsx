import { SLOT_POINTS } from "@milu/protocol";
import type { Host } from "@milu/window";
import { Tip } from "@milu/window/tooltip";
import { useEffect } from "react";
import { useStore } from "zustand";

import { FolderTreeIcon, PanelLeftOpenIcon } from "./icons.tsx";

const NO_ITEMS: readonly never[] = [];
const EXPLORER_VIEW = "explorer";

export function ChatBar(props: { host: Host }) {
	const { host } = props;
	const columns = useStore(host.columns.store, (state) => state.columns);
	const linked = useStore(host.connection.store, (state) => state.linked);
	const items = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatBar] ?? NO_ITEMS);
	const nameItems = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.chatName] ?? NO_ITEMS);
	const components = useStore(host.slots.store, (state) => state.components);

	const name = useStore(host.selection.store, (state) => state.selected);

	useEffect(() => {
		void host.slots.load(SLOT_POINTS.chatName, name || undefined);
	}, [host, name]);
	const running = useStore(host.sessions.store, (state) => state.rows.find((row) => row.name === name)?.running ?? false);
	const bare = name === "";
	const dockVisible = useStore(host.dock.store, (state) => state.visible);
	const dockActive = useStore(host.dock.store, (state) => state.active);
	const explorerOn = dockVisible && dockActive === EXPLORER_VIEW;

	return (
		<header className={`${columns.list.mode === "flow" ? "chat-bar" : "chat-bar at-edge"}${bare ? " is-bare" : ""}`}>
			<div className="chat-bar-lead">
				{columns.list.mode === "collapsed" ? (
					<Tip label="Show chat list (⌘B)">
						<button type="button" className="bar-icon list-expand" aria-label="Show chat list" onClick={() => host.columns.toggleList()}>
							<PanelLeftOpenIcon size={16} />
						</button>
					</Tip>
				) : null}
			</div>

			{bare ? null : (
				<div className="chat-bar-name">
					<Tip label="View details (⌘E)">
						<button type="button" className="chat-bar-name-text" aria-label={`${name} — view details`} onClick={() => void host.actions.invoke("details.session", name)}>
							<span>{name}</span>
						</button>
					</Tip>
					{running ? (
						<span className="chat-bar-status">
							<span className="work-dot" />
							<span className="work-dot" />
							<span className="work-dot" />
							Writing…
						</span>
					) : null}
					{nameItems.map((item) => {
						const Component = components.get(item.component);
						return Component ? <Component key={item.id} host={host} data={item.data} /> : null;
					})}
				</div>
			)}

			<div className="chat-bar-tools">
				<Tip label="Explorer (⌘J)">
					<button
						type="button"
						className={`bar-icon${explorerOn ? " on" : ""}`}
						aria-pressed={explorerOn}
						aria-label="Toggle explorer"
						onClick={() => host.dock.toggleView(EXPLORER_VIEW)}
					>
						<FolderTreeIcon size={16} />
					</button>
				</Tip>
				{items.map((item) => {
					const Component = components.get(item.component);
					return Component ? <Component key={item.id} host={host} data={item.data} /> : null;
				})}
				{linked ? null : (
					<Tip label="Disconnected">
						<span className="dot off" />
					</Tip>
				)}
			</div>
		</header>
	);
}
