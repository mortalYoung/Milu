import { Waypoints } from "lucide-react";
import { useStore } from "zustand";

import type { SlotComponent, SurfaceProps } from "../../host/index.ts";
import { Tip } from "../../host/tooltip.tsx";
import { TrajectoryServiceId } from "../service/index.ts";
import { TrajectoryDrawer } from "./drawer.tsx";

function TrajectoryButton(props: SurfaceProps) {
	const service = props.host.get(TrajectoryServiceId);
	const open = useStore(service.store, (state) => state.open);
	const selected = useStore(props.host.selection.store, (state) => state.selected);
	if (selected === "") return null;
	const wording = open ? "Hide trajectory" : "Show trajectory";
	return (
		<Tip label={wording}>
			<button
				type="button"
				className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 text-ink transition-colors duration-150 hover:bg-hover ${open ? "bg-hover" : "bg-transparent"}`}
				aria-label={wording}
				aria-pressed={open}
				onClick={() => void service.toggle()}
			>
				<Waypoints size={15} />
			</button>
		</Tip>
	);
}

function TrajectoryPane(props: SurfaceProps) {
	const service = props.host.get(TrajectoryServiceId);
	const open = useStore(service.store, (state) => state.open);
	if (!open) return null;
	return <TrajectoryDrawer host={props.host} service={service} />;
}

export const slots: readonly SlotComponent[] = [
	{ id: "trajectory.bar", component: TrajectoryButton },
	{ id: "trajectory.pane", component: TrajectoryPane },
];
