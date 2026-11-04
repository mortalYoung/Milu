import { EVENTS, type Session } from "@milu/core";

import { advanceNext, describeRule } from "./rules.ts";
import {
	appendRun,
	hasDefinitions,
	loadDefinitions,
	MISFIRE_GRACE_MS,
	newDefinition,
	readRuns,
	type RunRecord,
	runsToday,
	ScheduleConfigError,
	type ScheduleDefinition,
	type ScheduleRule,
	saveDefinitions,
} from "./store.ts";

export interface DueFire {
	readonly id: string;
	readonly runId: string;
	readonly scheduledAt: number;
	readonly trigger: "schedule" | "manual" | "catchup";
}

export interface DueMiss {
	readonly id: string;
	readonly runId: string;
	readonly scheduledAt: number;
}

export interface DuePlan {
	readonly fires: readonly DueFire[];
	readonly missed: readonly DueMiss[];
	readonly nextWakeAt: number | null;
}

export function duePlan(definitions: readonly ScheduleDefinition[], now: number): DuePlan {
	const fires: DueFire[] = [];
	const missed: DueMiss[] = [];
	let nextWakeAt: number | null = null;

	for (const definition of definitions) {
		if (!definition.enabled || definition.lifecycleStatus !== "active") continue;

		const wake = definition.nextRunAt;
		if (wake !== null && (nextWakeAt === null || wake < nextWakeAt)) nextWakeAt = wake;

		if (definition.nextRunAt === null || definition.nextRunAt > now) continue;
		const scheduledAt = definition.nextRunAt;
		const runId = `${definition.id}:${scheduledAt}`;
		if (now - scheduledAt <= MISFIRE_GRACE_MS) {
			fires.push({ id: definition.id, runId, scheduledAt, trigger: "schedule" });
			continue;
		}
		if (definition.schedule.kind === "interval") {
			fires.push({ id: definition.id, runId, scheduledAt, trigger: "catchup" });
			continue;
		}
		missed.push({ id: definition.id, runId, scheduledAt });
	}

	return { fires, missed, nextWakeAt };
}

export function reconcile(definitions: readonly ScheduleDefinition[], now: number): ScheduleDefinition[] {
	return definitions.map((definition) => {
		const active = definition.enabled && definition.lifecycleStatus === "active";
		return {
			...definition,
			nextRunAt: active ? advanceNext(definition.id, definition.schedule, now, true) : definition.nextRunAt,
			updatedAt: now,
		};
	});
}

export function applyFire(definition: ScheduleDefinition, now: number): ScheduleDefinition {
	const finished = definition.schedule.kind === "once";
	return {
		...definition,
		runCount: definition.runCount + 1,
		nextRunAt: finished ? null : advanceNext(definition.id, definition.schedule, now, true),
		lifecycleStatus: finished ? "finished" : definition.lifecycleStatus,
		updatedAt: now,
	};
}

export function applyMiss(definition: ScheduleDefinition, now: number): ScheduleDefinition {
	const finished = definition.schedule.kind === "once";
	return {
		...definition,
		nextRunAt: finished ? null : advanceNext(definition.id, definition.schedule, now, true),
		lifecycleStatus: finished ? "finished" : definition.lifecycleStatus,
		updatedAt: now,
	};
}

export function pause(definition: ScheduleDefinition, now: number): ScheduleDefinition {
	return { ...definition, enabled: false, lifecycleStatus: "paused", updatedAt: now };
}

export interface ScheduleClockOptions {
	readonly session: Session;
	readonly dailyCap: number;
	dispatch(definition: ScheduleDefinition, fire: DueFire): Promise<void>;
}

export class ScheduleClock {
	private _definitions: ScheduleDefinition[] = [];
	private _timer: ReturnType<typeof setTimeout> | null = null;
	private _ticking = false;

	constructor(private readonly _options: ScheduleClockOptions) {}

	async start(): Promise<void> {
		const now = Date.now();
		this._definitions = reconcile(await loadDefinitions(this._options.session.root), now);
		if (this._definitions.length > 0 || (await hasDefinitions(this._options.session.root))) await saveDefinitions(this._options.session.root, this._definitions);
		this._arm();
	}

	definitions(): readonly ScheduleDefinition[] {
		return this._definitions;
	}

	async create(input: { rule: ScheduleRule; text: string; title?: string; workspaceIdentity: string | null }): Promise<ScheduleDefinition> {
		const now = Date.now();
		const definition = newDefinition({
			id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
			title: input.title ?? "",
			display: describeRule(input.rule),
			schedule: input.rule,
			text: input.text,
			workspaceIdentity: input.workspaceIdentity,
			now,
			createdBy: "agent",
			nextRunAt: advanceNext(`s${now.toString(36)}`, input.rule, now, true),
		});
		this._definitions = [...this._definitions, definition];
		await saveDefinitions(this._options.session.root, this._definitions);
		this._arm();
		return definition;
	}

	async run(id: string): Promise<RunRecord> {
		const definition = this._definitions.find((item) => item.id === id);
		if (!definition) throw new Error(`no schedule "${id}"`);

		const at = Date.now();
		const fire: DueFire = { id, runId: `${id}:manual:${at}`, scheduledAt: at, trigger: "manual" };
		let record: RunRecord;
		try {
			await this._options.dispatch(definition, fire);
			record = { runId: fire.runId, scheduleId: id, scheduledAt: at, dispatchedAt: at, trigger: "manual", status: "dispatched" };
		} catch (failure) {
			const message = failure instanceof Error ? failure.message : String(failure);
			if (failure instanceof ScheduleConfigError) {
				this._definitions = this._definitions.map((item) => (item.id === id ? pause(item, at) : item));
				await saveDefinitions(this._options.session.root, this._definitions);
				this._arm();
			}
			record = { runId: fire.runId, scheduleId: id, scheduledAt: at, dispatchedAt: null, trigger: "manual", status: "skipped", error: message };
		}
		await this._note(record);
		return record;
	}

	stop(): void {
		if (this._timer) clearTimeout(this._timer);
		this._timer = null;
	}

	private _arm(): void {
		if (this._timer) clearTimeout(this._timer);
		this._timer = null;
		const now = Date.now();
		const plan = duePlan(this._definitions, now);
		if (plan.fires.length > 0) {
			this._timer = setTimeout(() => void this.tick(), 250);
			return;
		}
		if (plan.nextWakeAt === null) return;
		this._timer = setTimeout(() => void this.tick(), Math.max(250, Math.min(plan.nextWakeAt - now, 2 ** 31 - 1)));
	}

	async tick(): Promise<void> {
		if (this._ticking) return;
		this._ticking = true;
		try {
			const at = Date.now();
			const plan = duePlan(this._definitions, at);
			const records = await readRuns(this._options.session.root);
			let today = runsToday(records, at);

			for (const fire of plan.fires) {
				const definition = this._definitions.find((item) => item.id === fire.id);
				if (!definition) continue;

				if (today >= this._options.dailyCap) {
					this._definitions = this._definitions.map((item) => (item.id === fire.id ? pause(item, at) : item));
					await this._note({
						runId: fire.runId,
						scheduleId: fire.id,
						scheduledAt: fire.scheduledAt,
						dispatchedAt: null,
						trigger: fire.trigger,
						status: "skipped",
						error: "daily-cap",
					});
					continue;
				}

				this._definitions = this._definitions.map((item) => (item.id === fire.id ? applyFire(item, at) : item));
				await saveDefinitions(this._options.session.root, this._definitions);

				try {
					await this._options.dispatch(definition, fire);
					today += 1;
					await this._note({ runId: fire.runId, scheduleId: fire.id, scheduledAt: fire.scheduledAt, dispatchedAt: at, trigger: fire.trigger, status: "dispatched" });
				} catch (failure) {
					const message = failure instanceof Error ? failure.message : String(failure);
					if (failure instanceof ScheduleConfigError) this._definitions = this._definitions.map((item) => (item.id === fire.id ? pause(item, at) : item));
					await this._note({ runId: fire.runId, scheduleId: fire.id, scheduledAt: fire.scheduledAt, dispatchedAt: null, trigger: fire.trigger, status: "skipped", error: message });
				}
			}

			for (const miss of plan.missed) {
				if (!this._definitions.some((item) => item.id === miss.id)) continue;
				this._definitions = this._definitions.map((item) => (item.id === miss.id ? applyMiss(item, at) : item));
				await this._note({ runId: miss.runId, scheduleId: miss.id, scheduledAt: miss.scheduledAt, dispatchedAt: null, trigger: "schedule", status: "missed" });
			}

			await saveDefinitions(this._options.session.root, this._definitions);
		} finally {
			this._ticking = false;
			this._arm();
		}
	}

	private async _note(record: RunRecord): Promise<void> {
		await appendRun(this._options.session.root, record);
		await this._options.session.record(EVENTS.scheduleRun, { ...record, timestamp: Date.now() });
	}
}
