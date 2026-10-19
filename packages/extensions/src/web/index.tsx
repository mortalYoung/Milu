import type { DialogComponent, WidgetComponent } from "@milu/client";

import { CreateSessionDialog } from "./create.tsx";
import { SessionDetailsDialog } from "./details.tsx";
import { MeterWidget } from "./meter.tsx";
import { ModelsWidget } from "./models.tsx";
import { ShellWidget } from "./shell.tsx";

export const widgets: readonly WidgetComponent[] = [
	{ id: "models", component: ModelsWidget },
	{ id: "meter", component: MeterWidget },
	{ id: "shell", component: ShellWidget },
];

export const dialogs: readonly DialogComponent[] = [
	{ id: "create-session", component: CreateSessionDialog },
	{ id: "session-details", component: SessionDetailsDialog },
];
