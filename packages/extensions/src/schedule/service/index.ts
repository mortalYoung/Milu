import { expandHome, type Session, type SessionService, type SettingsPoint, type SettingsService } from "@milu/core";
import { createServiceId, type Service } from "@milu/di";

import { type DueFire, ScheduleClock } from "../clock.ts";
import { checkAgentCreate, parseCronWhen } from "../rules.ts";
import { hasDefinitions, loadDefinitions, readRuns, type RunRecord, ScheduleConfigError, type ScheduleDefinition } from "../store.ts";

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
