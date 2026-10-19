import type { DialogComponent, WidgetComponent } from "@milu/client";
import type { MarkdownPlugin } from "@milu/markdown";

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

export const markdown: readonly MarkdownPlugin[] = [];

export const dialogs: readonly DialogComponent[] = [
	{ id: "create-session", component: CreateSessionDialog },
	{ id: "session-details", component: SessionDetailsDialog },
];
