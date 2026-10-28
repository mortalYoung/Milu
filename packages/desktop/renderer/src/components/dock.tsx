import type { SlotItem } from "@milu/protocol";
import { DOCK_VIEWS_POINT, dockTabs, type Host } from "@milu/window";
import { ChevronRight, X } from "lucide-react";
import { type CSSProperties, createElement, useMemo } from "react";
import { useStore } from "zustand";

import { IconByName } from "./icons.tsx";

const NO_VIEWS: readonly SlotItem[] = [];

export function DockColumn(props: { host: Host }) {
	const { host } = props;
	const dock = useStore(host.columns.store, (state) => state.columns.dock);
	const opened = useStore(host.dock.store, (state) => state.opened);
	const active = useStore(host.dock.store, (state) => state.active);
	const views = useStore(host.slots.store, (state) => state.points[DOCK_VIEWS_POINT] ?? NO_VIEWS);
	const components = useStore(host.slots.store, (state) => state.components);

	const tabs = useMemo(() => dockTabs(views, opened), [views, opened]);
	const tab = tabs.find((each) => each.key === active) ?? tabs[0];
	const Component = tab === undefined ? undefined : components.get(tab.component);

	return (
		<div
			className={`column dock${dock.mode === "overlay" ? " floating" : ""}${dock.mode === "closed" ? " closed" : ""}`}
			style={{ "--dock-width": dock.mode === "closed" ? "0px" : `${dock.width}px` } as CSSProperties}
			inert={dock.mode === "closed"}
		>
			<div className="dock-tabs">
				{tabs.map((each) => (
					<div key={each.key} className={`dock-tab${each.key === tab?.key ? " is-active" : ""}`}>
						<button type="button" className="dock-tab-label" onClick={() => host.dock.select(each.key)} title={each.title}>
							<IconByName name={each.icon} size={13} />
							<span>{each.title}</span>
						</button>
						{each.pinned ? null : (
							<button type="button" className="dock-tab-close" aria-label={`Close ${each.title}`} onClick={() => host.dock.close(each.key)}>
								<X size={12} />
							</button>
						)}
					</div>
				))}
				<button type="button" className="dock-hide" aria-label="Hide the dock" onClick={() => host.dock.toggle()}>
					<ChevronRight size={14} />
				</button>
			</div>
			<div className="dock-body">{Component && tab ? createElement(Component, { host, data: tab.data }) : <p className="dock-empty">Nothing open</p>}</div>
		</div>
	);
}
