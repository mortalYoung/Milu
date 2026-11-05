import {
	type ExecutionEnv,
	type Extension,
	CHAT_NAME_POINT,
	SESSION_SIGNAL_POINT,
	WELCOME_TIMELINE_POINT,
	type Session,
	IContributionService,
	ISessionService,
	type SessionSignalItem,
	type SlotItem,
	ISettingsService,
	type ToolCall,
	type ToolResult,
	IToolService,
	Type,
} from "@milu/core";

import { ScheduleService, IScheduleService } from "./service/index.ts";
import { loadDefinitions, type ScheduleDefinition } from "./store.ts";

export { IScheduleService } from "./service/index.ts";

const schema = Type.Object({
	op: Type.Union([Type.Literal("list"), Type.Literal("create"), Type.Literal("run"), Type.Literal("delete")], {
		description: 'What to do: "list" the schedules on this chat, "create" a new one, "run" one now, or "delete" one.',
	}),
	when: Type.Optional(
		Type.String({
			description:
				'create: the clock, as a 5-field cron expression in local time — minute hour day-of-month month day-of-week. Examples: "30 10 * * *" (every day at 10:30), "*/15 * * * *" (every 15 minutes), "30 17 * * 5" (Fridays 17:30). A cron clock repeats: there is no one-shot form, and anything faster than every 15 minutes is refused.',
		}),
	),
	text: Type.Optional(Type.String({ description: "create: what this chat should do when it fires, written as the message it will receive." })),
	title: Type.Optional(Type.String({ description: "create: a short label a human will read in the schedule list. Defaults to the clock itself." })),
	id: Type.Optional(Type.String({ description: 'run or delete: the schedule id, as it appears at the start of a list line — e.g. "s1a2b3".' })),
});

interface ScheduleParams {
	op: "list" | "create" | "run" | "delete";
	when?: string;
	text?: string;
	title?: string;
	id?: string;
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

const scheduleExtension: Extension = {
	id: "schedule",
	apiVersion: 1,
	widgets: [
		{ id: "schedule.bar", type: "slot", entry: "./widget/schedule.tsx", export: "ScheduleButton" },
		{ id: "schedule.welcome", type: "slot", entry: "./widget/schedule.tsx", export: "ScheduleTimeline" },
		{ id: "schedule", type: "dialog", entry: "./widget/schedule.tsx", export: "ScheduleDialog" },
	],

	services: [{ id: IScheduleService, create: (container) => new ScheduleService(container.get(ISettingsService), container.get(ISessionService)) }],

	activate(context) {
		const schedule = context.get(IScheduleService);

		context.disposables.add(
			context
				.get(IContributionService)
				.get<SessionSignalItem>(SESSION_SIGNAL_POINT)
				.contribute({
					id: "schedule",
					order: 10,
					icon: "alarm-clock",
					title: async (session) => {
						const definitions = await loadDefinitions(session.root);
						if (definitions.length === 0) return null;
						return definitions.length === 1 ? "1 scheduled task" : `${definitions.length} scheduled tasks`;
					},
				}),
		);

		context.disposables.add(
			context
				.get(IContributionService)
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
				.get(IContributionService)
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
			id: "schedule.run",
			run: async ({ session, args }) => {
				if (!session) throw new Error("schedule.run needs a session");
				const id = typeof args === "object" && args !== null && "id" in args ? (args as { id?: unknown }).id : undefined;
				if (typeof id !== "string") throw new Error("schedule.run needs a schedule id");
				const result = await schedule.run(session, id);
				if (!result.ok) throw new Error(result.error);
				return { data: { session: session.name, ...(await schedule.snapshot(session)) } };
			},
		});

		context.actions.register({
			id: "schedule.open",
			run: async ({ session, dialog }) => {
				if (!session || !dialog) throw new Error("schedule.open needs a session");
				const data = await schedule.snapshot(session);
				await dialog({ kind: "custom", id: "schedule", title: "Scheduled", data: { session: session.name, ...data } });
			},
		});

		context.disposables.add(
			context.get(IToolService).register({
				name: "schedule",
				label: "Schedule",
				description:
					"Put work on a clock for this chat, or see what is already on it.\n" +
					"- list: every schedule on this chat, with its next run and how many times it has fired.\n" +
					"- create: one new schedule. It runs as a message to this chat, in this workspace, with the permission mode in force at that moment.\n" +
					"- run: send one now instead of waiting for the clock. Only an active schedule runs; its next fire does not move and the run does not count against the daily cap.\n" +
					"- delete: remove one schedule from this chat. Its past runs stay in the history; it only stops firing from now on — a run already dispatched cannot be taken back.\n" +
					"Milu only runs while it is open: a fire that comes due while the app is closed is missed, not queued up (a repeating one runs at most once on restart; a fixed-time one is skipped).\n" +
					"Ask first when the user has not asked for this themselves.",
				parameters: schema,
				async run(call: ToolCall, _env: ExecutionEnv) {
					const { op, when, text, title, id } = call.params as ScheduleParams;

					if (op === "list") {
						const definitions = await schedule.list(call.session);
						if (definitions.length === 0) return say("No schedules on this chat.");
						return say(`${definitions.length} schedule${definitions.length === 1 ? "" : "s"} on this chat:\n${definitions.map(scheduleLine).join("\n")}`);
					}

					if (op === "run") {
						if (!id) return say("run needs `id` — the schedule id from a list line.");
						const result = await schedule.run(call.session, id);
						if (!result.ok) return say(`Could not run it: ${result.error}`);
						if (result.record.status === "dispatched") return say(`Ran ${id} now — the message is in this chat.`);
						return say(`Tried ${id} now, but it was skipped: ${result.record.error ?? "unknown reason"}.`);
					}

					if (op === "delete") {
						if (!id) return say("delete needs `id` — the schedule id from a list line.");
						const result = await schedule.remove(call.session, id);
						if (!result.ok) return say(`Could not delete it: ${result.error}`);
						return say(result.removed ? `Deleted ${id}. Its past runs stay in the history.` : `No schedule "${id}" on this chat — nothing to delete.`);
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

export default scheduleExtension;
