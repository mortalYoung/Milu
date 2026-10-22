import { commandsTrigger } from "../commands/commands.tsx";
import { CreateSessionDialog } from "../create/create.tsx";
import { SessionDetailsDialog } from "../details/details.tsx";
import type { ComposerTriggerComponent, DialogComponent, FrontEndService, SlotComponent, WidgetComponent } from "../host/index.ts";
import type { MarkdownPlugin } from "../markdown/index.ts";
import { partnersTrigger } from "../mentions/mentions.tsx";
import { MeterWidget } from "../meter/meter.tsx";
import { ModelsWidget } from "../models/models.tsx";
import { slots as repliesSlots, services as repliesServices } from "../replies/replies.tsx";
import { ScheduleButton, ScheduleDialog, ScheduleTimeline } from "../schedule/schedule.tsx";
import { ShellWidget } from "../shell/shell.tsx";
import { TasksDialog, TasksWidget } from "../tasks/tasks.tsx";
import { slots as trajectorySlots, services as trajectoryServices } from "../trajectory/trajectory.tsx";

export const triggers: readonly ComposerTriggerComponent[] = [commandsTrigger, partnersTrigger];

export const widgets: readonly WidgetComponent[] = [
	{ id: "models", component: ModelsWidget },
	{ id: "meter", component: MeterWidget },
	{ id: "shell", component: ShellWidget },
	{ id: "tasks", component: TasksWidget },
];

export const markdown: readonly MarkdownPlugin[] = [];

export const services: readonly FrontEndService[] = [...repliesServices, ...trajectoryServices];

export const slots: readonly SlotComponent[] = [
	...repliesSlots,
	...trajectorySlots,
	{ id: "schedule.bar", component: ScheduleButton },
	{ id: "schedule.welcome", component: ScheduleTimeline },
];

export const dialogs: readonly DialogComponent[] = [
	{ id: "create-session", component: CreateSessionDialog },
	{ id: "session-details", component: SessionDetailsDialog },
	{ id: "tasks", component: TasksDialog },
	{ id: "schedule", component: ScheduleDialog },
];
