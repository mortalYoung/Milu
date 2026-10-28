import type { SlotItem } from "@milu/protocol";
import { SLOT_POINTS } from "@milu/protocol";
import { DOCK_VIEWS_POINT, dockTabs, type Host } from "@milu/window";
import { ChevronRight } from "lucide-react";
import { type CSSProperties, createElement, useMemo } from "react";
import { useStore } from "zustand";

const NO_VIEWS: readonly SlotItem[] = [];
const NO_ITEMS: readonly SlotItem[] = [];

export function DockColumn(props: { host: Host }) {
	const { host } = props;
	const dock = useStore(host.columns.store, (state) => state.columns.dock);
	const opened = useStore(host.dock.store, (state) => state.opened);
	const active = useStore(host.dock.store, (state) => state.active);
	const views = useStore(host.slots.store, (state) => state.points[DOCK_VIEWS_POINT] ?? NO_VIEWS);
	const barItems = useStore(host.slots.store, (state) => state.points[SLOT_POINTS.dockBar] ?? NO_ITEMS);
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
			<div className="dock-bar">
				{barItems.map((item) => {
					const BarComponent = components.get(item.component);
					return BarComponent ? <BarComponent key={item.id} host={host} data={item.data} /> : null;
				})}
				<button type="button" className="dock-hide" aria-label="Hide the dock" onClick={() => host.dock.toggle()}>
					<ChevronRight size={14} />
				</button>
			</div>
			<div className="dock-body">{Component && tab ? createElement(Component, { host, data: tab.data }) : <p className="dock-empty">Nothing open</p>}</div>
		</div>
	);
}
