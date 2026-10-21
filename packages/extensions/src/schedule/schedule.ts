import {
	type ExecutionEnv,
	type Extension,
	CHAT_NAME_POINT,
	WELCOME_TIMELINE_POINT,
	type Session,
	type SessionService,
	ContributionServiceId,
	SessionServiceId,
	type SettingsPoint,
	type SlotItem,
	expandHome,
	type SettingsService,
	SettingsServiceId,
	type ToolCall,
	type ToolResult,
	ToolServiceId,
	Type,
} from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { type DueFire, ScheduleClock } from "./clock.ts";
import { checkAgentCreate, parseCronWhen } from "./rules.ts";
import { hasDefinitions, loadDefinitions, readRuns, type RunRecord, ScheduleConfigError, type ScheduleDefinition } from "./store.ts";

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

export interface Upcoming {
	readonly session: string;
	readonly id: string;
	readonly title: string;
	readonly at: number;
}

export class ScheduleService implements Service {
	private readonly _clocks = new Map<string, ScheduleClock>();
	private _enabled: SettingsPoint<boolean> | null = null;
	private _dailyCap: SettingsPoint<number> | null = null;

	constructor(
		private readonly _settingsService: SettingsService,
		private readonly _sessionService: SessionService,
	) {}

	async initialize(): Promise<void> {
		this._enabled = this._settingsService.declare({ key: "schedulesEnabled", defaults: true });
		this._dailyCap = this._settingsService.declare({ key: "schedulesDailyCap", defaults: 200 });

		// A clock has to be armed before anyone opens the chat: the service initializes after SessionService, so the names are real here.
		for (const name of await this._sessionService.names()) {
			const session = this._sessionService.get(name);
			if (await hasDefinitions(session.root)) await this.start(session);
		}
	}

	async start(session: Session): Promise<ScheduleClock | null> {
		const existing = this._clocks.get(session.name);
		if (existing) return existing;
		if (this._enabled?.get() === false) return null;

		const clock = new ScheduleClock({
			session,
			dailyCap: this._dailyCap?.get() ?? 200,
			dispatch: (definition, fire) => this._dispatch(session, definition, fire),
		});
		this._clocks.set(session.name, clock);
		await clock.start();
		return clock;
	}

	async clock(session: Session): Promise<ScheduleClock | null> {
		return this._clocks.get(session.name) ?? (await this.start(session));
	}

	async snapshot(session: Session): Promise<{ schedules: readonly ScheduleDefinition[]; runs: readonly RunRecord[] }> {
		const clock = await this.clock(session);
		const runs = await readRuns(session.root);
		return { schedules: clock?.definitions() ?? [], runs: runs.slice(-60) };
	}

	async list(session: Session): Promise<readonly ScheduleDefinition[]> {
		const clock = await this.clock(session);
		return clock?.definitions() ?? [];
	}

	async upcoming(): Promise<readonly Upcoming[]> {
		const rows: Upcoming[] = [];
		for (const name of await this._sessionService.names()) {
			const session = this._sessionService.get(name);
			const definitions = this._clocks.get(name)?.definitions() ?? (await loadDefinitions(session.root));
			for (const definition of definitions) {
				if (!definition.enabled || definition.lifecycleStatus !== "active") continue;
				const at = definition.nextRunAt;
				if (at === null) continue;
				rows.push({ session: name, id: definition.id, title: definition.title, at });
			}
		}
		return rows.sort((left, right) => left.at - right.at || left.session.localeCompare(right.session) || left.id.localeCompare(right.id));
	}

	async create(session: Session, input: { when: string; text: string; title?: string }): Promise<{ ok: true; definition: ScheduleDefinition } | { ok: false; error: string }> {
		if (input.text.trim() === "") return { ok: false, error: "a scheduled task needs something to do" };
		const clock = await this.clock(session);
		if (!clock) return { ok: false, error: "scheduling is disabled in settings" };

		const now = Date.now();
		const parsed = parseCronWhen(input.when, now);
		if (!parsed.rule || parsed.error) return { ok: false, error: parsed.error ?? "invalid clock" };

		const refusal = checkAgentCreate(clock.definitions(), parsed.rule, now);
		if (refusal) return { ok: false, error: refusal };

		const workspace = await session.workspace();
		const definition = await clock.create({
			rule: parsed.rule,
			text: input.text,
			workspaceIdentity: workspace ? expandHome(workspace.path) : null,
			...(input.title ? { title: input.title } : {}),
		});
		return { ok: true, definition };
	}

	dispose(): void {
		for (const clock of this._clocks.values()) clock.stop();
		this._clocks.clear();
	}

	private async _dispatch(session: Session, definition: ScheduleDefinition, fire: DueFire): Promise<void> {
		const workspace = await session.workspace();
		const identity = workspace ? expandHome(workspace.path) : null;
		if (definition.workspaceIdentity != null && identity !== definition.workspaceIdentity) throw new ScheduleConfigError("workspace changed since this schedule was created");

		await session.deliver(definition.payload.text, { schedule: { scheduleId: definition.id, runId: fire.runId, title: definition.title } });
	}
}

export const ScheduleServiceId = createServiceId<ScheduleService>("schedule.clock");

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
