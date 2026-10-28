import { SLOT_POINTS } from "@milu/protocol";
import type { Host } from "@milu/window";
import { TooltipProvider } from "@milu/window/tooltip";
import { useStore } from "zustand";

import { Workbench } from "./workbench.tsx";

const NO_ITEMS: readonly never[] = [];

function Overlay(props: { host: Host }) {
	const items = useStore(props.host.slots.store, (state) => state.points[SLOT_POINTS.overlay] ?? NO_ITEMS);
	const components = useStore(props.host.slots.store, (state) => state.components);
	return (
		<>
			{items.map((item) => {
				const Component = components.get(item.component);
				return Component ? <Component key={item.id} host={props.host} data={item.data} /> : null;
			})}
		</>
	);
}

export function Root(props: { host: Host }) {
	return (
		<TooltipProvider delayDuration={120}>
			<Workbench host={props.host} />
			<Overlay host={props.host} />
		</TooltipProvider>
	);
}
