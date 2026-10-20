import type { DialogComponent, FrontEndService, SlotComponent, WidgetComponent } from "@milu/client";
import type { MarkdownPlugin } from "@milu/markdown";

import { CreateSessionDialog } from "../create/create.tsx";
import { SessionDetailsDialog } from "../details/details.tsx";
import { MeterWidget } from "../meter/meter.tsx";
import { ModelsWidget } from "../models/models.tsx";
import { slots as repliesSlots, services as repliesServices } from "../replies/replies.tsx";
import { ShellWidget } from "../shell/shell.tsx";

export const widgets: readonly WidgetComponent[] = [
	{ id: "models", component: ModelsWidget },
	{ id: "meter", component: MeterWidget },
	{ id: "shell", component: ShellWidget },
];

export const markdown: readonly MarkdownPlugin[] = [];

export const services: readonly FrontEndService[] = [...repliesServices];

export const slots: readonly SlotComponent[] = [...repliesSlots];

export const dialogs: readonly DialogComponent[] = [
	{ id: "create-session", component: CreateSessionDialog },
	{ id: "session-details", component: SessionDetailsDialog },
];
