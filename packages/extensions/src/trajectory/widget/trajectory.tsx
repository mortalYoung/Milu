import type { SurfaceProps } from "@milu/window/api";
import { Tip } from "@milu/window/api/tooltip";
import { Waypoints } from "lucide-react";
import { useStore } from "zustand";

import { ITrajectoryService } from "../service/index.ts";
import { TrajectoryDrawer } from "./drawer.tsx";

export function TrajectoryButton(props: SurfaceProps) {
	const service = props.host.get(ITrajectoryService);
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

export function TrajectoryPane(props: SurfaceProps) {
	const service = props.host.get(ITrajectoryService);
	const open = useStore(service.store, (state) => state.open);
	if (!open) return null;
	return <TrajectoryDrawer host={props.host} service={service} />;
}
