import type { Host } from "@milu/window";
import { TooltipProvider } from "@milu/window/tooltip";

import { Workbench } from "./workbench.tsx";

export function Root(props: { host: Host }) {
	return (
		<TooltipProvider delayDuration={120}>
			<Workbench host={props.host} />
		</TooltipProvider>
	);
}
