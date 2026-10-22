import {
	type ExecutionEnv,
	type Extension,
	CHAT_NAME_POINT,
	WELCOME_TIMELINE_POINT,
	type Session,
	ContributionServiceId,
	SessionServiceId,
	type SlotItem,
	SettingsServiceId,
	type ToolCall,
	type ToolResult,
	ToolServiceId,
	Type,
} from "@milu/core";

import { ScheduleService, ScheduleServiceId } from "./service/index.ts";
import { type ScheduleDefinition } from "./store.ts";

export { ScheduleServiceId } from "./service/index.ts";

const schema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("create")], { description: 'What to do: "list" the schedules on this chat, or "create" a new one.' }),
	when: Type.Optional(
		Type.String({
			description:
				'create: the clock, as a 5-field cron expression in local time — minute hour day-of-month month day-of-week. Examples: "30 10 * * *" (every day at 10:30), "*/15 * * * *" (every 15 minutes), "30 17 * * 5" (Fridays 17:30). A cron clock repeats: there is no one-shot form, and anything faster than every 15 minutes is refused.',
		}),
	),
	text: Type.Optional(Type.String({ description: "create: what this chat should do when it fires, written as the message it will receive." })),
	title: Type.Optional(Type.String({ description: "create: a short label a human will read in the schedule list. Defaults to the clock itself." })),
});

interface ScheduleParams {
	op: "list" | "create";
	when?: string;
	text?: string;
	title?: string;
}

function clockOf(at: number | null): string {
	if (at === null) return "not scheduled";
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scheduleLine(definition: ScheduleDefinition): string {
	const status = definition.lifecycleStatus === "active" && definition.enabled ? "active" : definition.lifecycleStatus;
	const head = `- ${definition.id} · ${definition.display} · ${status} · next ${clockOf(definition.nextRunAt)} · ${definition.runCount} fires`;
	const tail = [definition.title, definition.payload.text.length > 120 ? `${definition.payload.text.slice(0, 120)}…` : definition.payload.text].filter(Boolean).join(" — ");
	return `${head}\n  ${tail}`;
}

export const scheduleExtension: Extension = {
	id: "schedule",
	apiVersion: 1,

	services: [{ id: ScheduleServiceId, create: (container) => new ScheduleService(container.get(SettingsServiceId), container.get(SessionServiceId)) }],

	activate(context) {
		const schedule = context.get(ScheduleServiceId);

		context.disposables.add(
			context
				.get(ContributionServiceId)
				.get<SlotItem>(CHAT_NAME_POINT)
				.contribute({
					id: "schedule",
					component: "schedule.bar",
					order: 10,
					data: async (session: Session) => {
						const snapshot = await schedule.snapshot(session);
						return snapshot.schedules.length === 0 ? null : { session: session.name, ...snapshot };
					},
				}),
		);

		context.disposables.add(
			context
				.get(ContributionServiceId)
				.get<SlotItem>(WELCOME_TIMELINE_POINT)
				.contribute({
					id: "schedule",
					component: "schedule.welcome",
					order: 10,
					data: async () => {
						const rows = await schedule.upcoming();
						return rows.length === 0 ? null : { rows };
					},
				}),
		);

		context.actions.register({
			id: "schedule.open",
			run: async ({ session, dialog }) => {
				if (!session || !dialog) throw new Error("schedule.open needs a session");
				const data = await schedule.snapshot(session);
				await dialog({ kind: "custom", id: "schedule", title: "Scheduled", data: { session: session.name, ...data } });
			},
		});

		context.disposables.add(
			context.get(ToolServiceId).register({
				name: "schedule",
				label: "Schedule",
				description:
					"Put work on a clock for this chat, or see what is already on it.\n" +
					"- list: every schedule on this chat, with its next run and how many times it has fired.\n" +
					"- create: one new schedule. It runs as a message to this chat, in this workspace, with the permission mode in force at that moment.\n" +
					"Milu only runs while it is open: a fire that comes due while the app is closed is missed, not queued up (a repeating one runs at most once on restart; a fixed-time one is skipped).\n" +
					"Ask first when the user has not asked for this themselves.",
				parameters: schema,
				async run(call: ToolCall, _env: ExecutionEnv) {
					const { op, when, text, title } = call.params as ScheduleParams;

					if (op === "list") {
						const definitions = await schedule.list(call.session);
						if (definitions.length === 0) return say("No schedules on this chat.");
						return say(`${definitions.length} schedule${definitions.length === 1 ? "" : "s"} on this chat:\n${definitions.map(scheduleLine).join("\n")}`);
					}

					if (!when || !text) return say("create needs both `when` (a 5-field cron expression) and `text` (what to do).");
					const result = await schedule.create(call.session, { when, text, ...(title ? { title } : {}) });
					if (!result.ok) {
						return say(`Could not create it: ${result.error}\nAccepted clocks: a 5-field cron expression, e.g. "30 10 * * *" · "*/15 * * * *" · "30 17 * * 5".`);
					}
					return say(`Created ${result.definition.id} · ${result.definition.display} · next ${clockOf(result.definition.nextRunAt)}.`);
				},
			}),
		);
	},
};

function say(value: string): ToolResult {
	return { content: [{ type: "text", text: value }], details: {} };
}
