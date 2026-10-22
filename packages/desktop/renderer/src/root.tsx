import type { Host } from "@milu/extensions/host";
import { TooltipProvider } from "@milu/extensions/host/tooltip";

import { Workbench } from "./workbench.tsx";

export function Root(props: { host: Host }) {
	return (
		<TooltipProvider delayDuration={120}>
			<Workbench host={props.host} />
		</TooltipProvider>
	);
}
