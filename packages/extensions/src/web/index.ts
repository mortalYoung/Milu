import { commandsTrigger } from "../commands/widget/commands.tsx";
import { CreateSessionDialog } from "../create/widget/create.tsx";
import { SessionDetailsDialog } from "../details/widget/details.tsx";
import type { ComposerTriggerComponent, DialogComponent, FrontEndService, SlotComponent, WidgetComponent } from "../host/index.ts";
import type { MarkdownPlugin } from "../markdown/index.ts";
import { partnersTrigger } from "../mentions/widget/mentions.tsx";
import { MeterWidget } from "../meter/widget/meter.tsx";
import { ModelsWidget } from "../models/widget/models.tsx";
import { services as repliesServices } from "../replies/service/index.ts";
import { slots as repliesSlots } from "../replies/widget/replies.tsx";
import { ScheduleButton, ScheduleDialog, ScheduleTimeline } from "../schedule/widget/schedule.tsx";
import { ShellWidget } from "../shell/widget/shell.tsx";
import { TasksDialog, TasksWidget } from "../tasks/widget/tasks.tsx";
import { services as trajectoryServices } from "../trajectory/service/index.ts";
import { slots as trajectorySlots } from "../trajectory/widget/trajectory.tsx";

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
