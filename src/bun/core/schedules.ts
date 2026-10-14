import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Cron } from "croner";
import { parseScheduleInput } from "../../shared/schedule-when";

export type ScheduleKind = "once" | "interval" | "cron";

export type ScheduleRule = { kind: "once"; at: number } | { kind: "interval"; anchor: number; everyMs: number } | { kind: "cron"; expression: string };

export type ScheduleLifecycle = "active" | "paused" | "finished";

export interface ScheduleDefinition {
	id: string;
	schemaVersion: number;
	title: string;
	display: string;
	schedule: ScheduleRule;
	payload: { kind: "prompt"; text: string };
	workspaceIdentity: string | null;
	enabled: boolean;
	lifecycleStatus: ScheduleLifecycle;
	nextRunAt: number | null;
	retryAt: number | null;
	running: boolean;
	claimedAt: number | null;
	attempts: number;
	lastError: string | null;
	runCount: number;
	createdAt: number;
	updatedAt: number;
	createdBy: "user" | "agent";
}

export class ScheduleConfigError extends Error {}

/** The chat was already busy: this fire is skipped, not retried (overlap never queues up). */
export class ScheduleBusyError extends Error {}

export type ScheduleRunStatus = "dispatched" | "done" | "failed" | "skipped" | "missed";

export interface ScheduleRunRecord {
	runId: string;
	scheduleId: string;
	scheduledAt: number;
	dispatchedAt: number | null;
	trigger: "schedule" | "manual" | "catchup";
	status: ScheduleRunStatus;
	sessionId?: string;
	error?: string;
	attempts: number;
}

export const SCHEMA_VERSION = 1;
export const MISFIRE_GRACE_MS = 5 * 60_000;
export const MIN_INTERVAL_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_ACTIVE_DEFINITIONS = 20;
export const MIN_AGENT_INTERVAL_MS = 15 * 60_000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_CAP_MS = 15 * 60_000;
export const ZOMBIE_MS = 10 * 60_000;
export const JITTER_CALENDAR_MS = 15_000;
export const JITTER_INTERVAL_MS = 60_000;

export function jitterFor(id: string, span: number): number {
	let hash = 2166136261;
	for (let i = 0; i < id.length; i++) {
		hash ^= id.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % Math.max(1, span);
}

export function backoffMs(attempts: number): number {
	return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export function nextIntervalAt(anchor: number, everyMs: number, from: number): number {
	if (from <= anchor) return anchor;
	return anchor + (Math.floor((from - anchor) / everyMs) + 1) * everyMs;
}

export function parseCron(expression: string): Cron | null {
	try {
		return new Cron(expression, { paused: true });
	} catch {
		return null;
	}
}

export function nextFire(rule: ScheduleRule, from: number): number | null {
	if (rule.kind === "once") return rule.at > from ? rule.at : null;
	if (rule.kind === "interval") return nextIntervalAt(rule.anchor, rule.everyMs, from);
	const cron = parseCron(rule.expression);
	if (!cron) return null;
	const next = cron.nextRun(new Date(from));
	cron.stop();
	return next ? next.getTime() : null;
}

function jitterSpan(rule: ScheduleRule): number {
	return rule.kind === "interval" ? JITTER_INTERVAL_MS : JITTER_CALENDAR_MS;
}

export function advanceNext(id: string, rule: ScheduleRule, from: number, jitter: boolean): number | null {
	const base = nextFire(rule, from);
	if (base == null) return null;
	if (!jitter || rule.kind === "once") return base;
	return base + jitterFor(id, jitterSpan(rule));
}

// ——— plan (pure) ———

export type DueTrigger = "schedule" | "catchup" | "manual";

export interface DueFire {
	kind: "fire";
	id: string;
	runId: string;
	scheduledAt: number;
	retry: number;
	trigger: DueTrigger;
}

export interface DueMiss {
	kind: "missed";
	id: string;
	runId: string;
	scheduledAt: number;
}

export interface DuePlan {
	fires: DueFire[];
	missed: DueMiss[];
	nextWakeAt: number | null;
}

export function duePlan(definitions: ScheduleDefinition[], now: number): DuePlan {
	const fires: DueFire[] = [];
	const missed: DueMiss[] = [];
	let nextWakeAt: number | null = null;

	for (const definition of definitions) {
		if (!definition.enabled || definition.lifecycleStatus !== "active") continue;

		if (definition.retryAt != null && definition.retryAt <= now) {
			const scheduledAt = definition.nextRunAt ?? definition.retryAt;
			fires.push({
				kind: "fire",
				id: definition.id,
				runId: `${definition.id}:${scheduledAt}`,
				scheduledAt,
				retry: definition.attempts + 1,
				trigger: "schedule",
			});
			continue;
		}

		const wake = definition.retryAt ?? definition.nextRunAt;
		if (wake != null && (nextWakeAt == null || wake < nextWakeAt)) nextWakeAt = wake;

		if (definition.nextRunAt != null) {
			if (definition.nextRunAt > now) continue;
			const late = now - definition.nextRunAt;
			const scheduledAt = definition.nextRunAt;
			const runId = `${definition.id}:${scheduledAt}`;
			if (late <= MISFIRE_GRACE_MS) {
				fires.push({ kind: "fire", id: definition.id, runId, scheduledAt, retry: 0, trigger: "schedule" });
				continue;
			}
			if (definition.schedule.kind === "interval") {
				fires.push({ kind: "fire", id: definition.id, runId, scheduledAt, retry: 0, trigger: "catchup" });
				continue;
			}
			missed.push({ kind: "missed", id: definition.id, runId, scheduledAt });
		}
	}

	return { fires, missed, nextWakeAt };
}

export function reconcile(definitions: ScheduleDefinition[], now: number): ScheduleDefinition[] {
	return definitions.map((definition) => {
		const active = definition.enabled && definition.lifecycleStatus === "active";
		return {
			...definition,
			running: false,
			claimedAt: null,
			retryAt: null,
			attempts: 0,
			nextRunAt: active ? advanceNext(definition.id, definition.schedule, now, true) : definition.nextRunAt,
			updatedAt: now,
		};
	});
}

/** A claim older than the zombie window means the holder died mid-run: reclaim it. */
export function reapZombies(definitions: ScheduleDefinition[], now: number): ScheduleDefinition[] {
	return definitions.map((definition) => {
		if (!definition.running || definition.claimedAt == null || now - definition.claimedAt <= ZOMBIE_MS) return definition;
		return { ...definition, running: false, claimedAt: null, updatedAt: now };
	});
}

export function applyFire(definition: ScheduleDefinition, fire: DueFire, now: number): ScheduleDefinition {
	const finished = definition.schedule.kind === "once";
	return {
		...definition,
		running: true,
		claimedAt: now,
		retryAt: null,
		attempts: fire.retry,
		lastError: null,
		runCount: definition.runCount + 1,
		nextRunAt: finished ? null : advanceNext(definition.id, definition.schedule, now, true),
		lifecycleStatus: finished ? "finished" : definition.lifecycleStatus,
		updatedAt: now,
	};
}

export function applyMiss(definition: ScheduleDefinition, _miss: DueMiss, now: number): ScheduleDefinition {
	const finished = definition.schedule.kind === "once";
	return {
		...definition,
		nextRunAt: finished ? null : advanceNext(definition.id, definition.schedule, now, true),
		lifecycleStatus: finished ? "finished" : definition.lifecycleStatus,
		updatedAt: now,
	};
}

export function applyFailure(definition: ScheduleDefinition, error: string, now: number): ScheduleDefinition {
	const attempts = definition.attempts + 1;
	if (attempts >= MAX_ATTEMPTS) {
		return { ...definition, attempts: 0, running: false, claimedAt: null, retryAt: null, lastError: error, updatedAt: now };
	}
	return { ...definition, attempts, running: false, claimedAt: null, retryAt: now + backoffMs(attempts), lastError: error, updatedAt: now };
}

/** A configuration failure cannot heal by retrying: stop the loop and say why. */
export function applyConfigFailure(definition: ScheduleDefinition, error: string, now: number): ScheduleDefinition {
	return { ...definition, enabled: false, lifecycleStatus: "paused", attempts: 0, running: false, claimedAt: null, retryAt: null, lastError: error, updatedAt: now };
}

export function settle(definitions: ScheduleDefinition[], id: string, now: number): ScheduleDefinition[] {
	return definitions.map((definition) => (definition.id === id ? { ...definition, running: false, claimedAt: null, attempts: 0, updatedAt: now } : definition));
}

export function describeRule(rule: ScheduleRule): string {
	if (rule.kind === "once") return `once · ${stamp(rule.at)}`;
	if (rule.kind === "interval") return `every ${intervalLabel(rule.everyMs)}`;
	const parts = rule.expression.trim().split(/\s+/);
	const [minute, hour] = parts;
	if (parts.length === 5 && minute === "0" && /^\d+$/.test(hour ?? "")) return `daily ${hour.padStart(2, "0")}:00`;
	return `cron ${rule.expression}`;
}

function intervalLabel(everyMs: number): string {
	if (everyMs % 3_600_000 === 0) return `${everyMs / 3_600_000}h`;
	if (everyMs % 60_000 === 0) return `${everyMs / 60_000}m`;
	return `${Math.round(everyMs / 1000)}s`;
}

function stamp(at: number): string {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface ParsedWhen {
	rule: ScheduleRule;
	describe: string;
	error?: string;
}

/** The clock a model may write: a 5-field cron expression, local time, nothing else. */
export function parseCronWhen(when: string, now: number): ParsedWhen {
	const expression = when
		.trim()
		.replace(/^cron:/i, "")
		.replace(/\s+/g, " ");
	const fields = expression.split(" ");
	if (fields.length !== 5 || !/^[\d*/,\-\s]+$/.test(expression))
		return { rule: { kind: "cron", expression: "0 9 * * *" }, describe: "", error: `"${when.trim()}" is not a 5-field cron expression` };
	const cron = parseCron(expression);
	if (!cron || cron.nextRun(new Date(now)) == null) return { rule: { kind: "cron", expression }, describe: "", error: `"${expression}" never fires` };
	cron.stop();
	const rule: ScheduleRule = { kind: "cron", expression };
	return { rule, describe: describeRule(rule) };
}

/** The one place a "when" string becomes a rule: human words are canonicalised first, then the rule is built. */
export function parseWhen(when: string, now: number): ParsedWhen {
	const canonical = parseScheduleInput(when, now);
	if (canonical.error) return { rule: { kind: "cron", expression: "0 9 * * *" }, describe: "", error: canonical.error };
	const input = canonical.when
		.replace(/^cron:/, "")
		.replace(/^every:/, "interval:")
		.trim();
	if (input.startsWith("interval:")) {
		const everyMs = durationMs(input.slice("interval:".length));
		if (everyMs == null || everyMs < MIN_INTERVAL_MS)
			return { rule: { kind: "interval", anchor: now, everyMs: MIN_INTERVAL_MS }, describe: "", error: "interval must be at least 1m" };
		const rule: ScheduleRule = { kind: "interval", anchor: now + everyMs, everyMs };
		return { rule, describe: describeRule(rule) };
	}
	if (input.startsWith("at:")) {
		const at = Number(input.slice(3).trim());
		if (!Number.isFinite(at) || at <= now) return { rule: { kind: "once", at: now }, describe: "", error: "time must be in the future" };
		const rule: ScheduleRule = { kind: "once", at };
		return { rule, describe: describeRule(rule) };
	}
	const cron = parseCron(input);
	if (!cron || cron.nextRun(new Date(now)) == null) return { rule: { kind: "cron", expression: input }, describe: "", error: `invalid cron: ${input}` };
	cron.stop();
	const rule: ScheduleRule = { kind: "cron", expression: input };
	return { rule, describe: describeRule(rule) };
}

function durationMs(text: string): number | null {
	const match = text.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
	if (!match) return null;
	const value = Number(match[1]);
	const unit = (match[2] ?? "m").toLowerCase();
	const scale = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
	return Math.round(value * scale);
}

/** What the model may put on the clock: bounded in count, and never faster than a human could keep up with. */
export function checkAgentCreate(definitions: ScheduleDefinition[], rule: ScheduleRule, now: number): string | null {
	const active = definitions.filter((item) => item.enabled && item.lifecycleStatus === "active").length;
	if (active >= MAX_ACTIVE_DEFINITIONS) return `this chat already has ${MAX_ACTIVE_DEFINITIONS} active schedules`;
	const first = nextFire(rule, now);
	if (first == null) return "that time is already past";
	const second = nextFire(rule, first + 1000);
	const gap = second == null ? Number.POSITIVE_INFINITY : second - first;
	if (gap < MIN_AGENT_INTERVAL_MS) return "the fastest I may schedule is every 15 minutes";
	return null;
}

// ——— storage ———

export function schedulesDir(partnerDir: string): string {
	return join(partnerDir, "schedules");
}

export function definitionsPath(partnerDir: string): string {
	return join(schedulesDir(partnerDir), "tasks.json");
}

export function runsPath(partnerDir: string): string {
	return join(schedulesDir(partnerDir), "runs.jsonl");
}

export async function hasSchedules(partnerDir: string): Promise<boolean> {
	try {
		await access(definitionsPath(partnerDir));
		return true;
	} catch {
		return false;
	}
}

export async function loadSchedules(partnerDir: string): Promise<ScheduleDefinition[]> {
	try {
		const parsed = JSON.parse(await readFile(definitionsPath(partnerDir), "utf8")) as { tasks?: unknown };
		if (!Array.isArray(parsed?.tasks)) return [];
		return parsed.tasks.filter(isDefinition);
	} catch {
		return [];
	}
}

function isDefinition(value: unknown): value is ScheduleDefinition {
	const record = value as ScheduleDefinition | null;
	return Boolean(record && typeof record.id === "string" && typeof record.schedule === "object" && record.schedule !== null);
}

export async function saveSchedules(partnerDir: string, definitions: ScheduleDefinition[]): Promise<void> {
	const dir = schedulesDir(partnerDir);
	await mkdir(dir, { recursive: true });
	const target = definitionsPath(partnerDir);
	const temp = `${target}.tmp`;
	await writeFile(temp, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, tasks: definitions }, null, 2)}\n`, "utf8");
	await rename(temp, target);
}

export async function appendRun(partnerDir: string, record: ScheduleRunRecord): Promise<void> {
	await mkdir(schedulesDir(partnerDir), { recursive: true });
	await appendFile(runsPath(partnerDir), `${JSON.stringify(record)}\n`, "utf8");
}

/** The quit path cannot await: the claim is released with a plain sync write. */
export function saveSchedulesSync(partnerDir: string, definitions: ScheduleDefinition[]): void {
	try {
		mkdirSync(schedulesDir(partnerDir), { recursive: true });
		writeFileSync(definitionsPath(partnerDir), `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, tasks: definitions }, null, 2)}\n`, "utf8");
	} catch (error) {
		console.error("schedule claim release failed:", error);
	}
}

export async function readRuns(partnerDir: string): Promise<ScheduleRunRecord[]> {
	try {
		const raw = await readFile(runsPath(partnerDir), "utf8");
		return raw
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line) as ScheduleRunRecord);
	} catch {
		return [];
	}
}

export function runsToday(records: ScheduleRunRecord[], now: number): number {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const from = start.getTime();
	return records.filter((record) => record.status !== "missed" && record.status !== "skipped" && (record.dispatchedAt ?? record.scheduledAt) >= from).length;
}

export function newDefinition(input: {
	id: string;
	title: string;
	display: string;
	schedule: ScheduleRule;
	payload: { kind: "prompt"; text: string };
	workspaceIdentity: string | null;
	createdBy: "user" | "agent";
	now: number;
}): ScheduleDefinition {
	return {
		id: input.id,
		schemaVersion: SCHEMA_VERSION,
		title: input.title,
		display: input.display,
		schedule: input.schedule,
		payload: input.payload,
		workspaceIdentity: input.workspaceIdentity,
		enabled: true,
		lifecycleStatus: "active",
		nextRunAt: advanceNext(input.id, input.schedule, input.now, true),
		retryAt: null,
		running: false,
		claimedAt: null,
		attempts: 0,
		lastError: null,
		runCount: 0,
		createdAt: input.now,
		updatedAt: input.now,
		createdBy: input.createdBy,
	};
}

// ——— clock ———

export interface ScheduleClockOptions {
	partnerDir: string;
	dispatch(fire: DueFire): Promise<void>;
	now?: () => number;
	maxConcurrent?: number;
	dailyCap?: number;
	onChange?: (definitions: ScheduleDefinition[]) => void;
	onSettle?: (record: ScheduleRunRecord) => void;
}

export interface ScheduleClock {
	start(): Promise<void>;
	tick(): Promise<void>;
	settle(id: string, status: "done" | "failed", details?: { runId?: string; error?: string; sessionId?: string }): Promise<void>;
	noteDispatched(fire: DueFire): Promise<void>;
	update(mutate: (definitions: ScheduleDefinition[]) => ScheduleDefinition[]): Promise<ScheduleDefinition[]>;
	definitions(): ScheduleDefinition[];
	stop(): void;
}

export function createScheduleClock(options: ScheduleClockOptions): ScheduleClock {
	const now = options.now ?? Date.now;
	const maxConcurrent = options.maxConcurrent ?? 3;
	const dailyCap = options.dailyCap ?? 200;
	let definitions: ScheduleDefinition[] = [];
	let ledger: ScheduleRunRecord[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running = false;

	function arm(): void {
		if (timer) clearTimeout(timer);
		timer = null;
		const plan = duePlan(definitions, now());
		if (plan.fires.length > 0) {
			timer = setTimeout(() => void tick(), 250);
			return;
		}
		if (plan.nextWakeAt == null) return;
		const delay = Math.max(250, Math.min(plan.nextWakeAt - now(), 2 ** 31 - 1));
		timer = setTimeout(() => void tick(), delay);
	}

	function withNext(id: string, at: number, patch: Partial<ScheduleDefinition> = {}): void {
		definitions = definitions.map((item) => (item.id === id ? { ...item, ...patch, nextRunAt: advanceNext(item.id, item.schedule, at, true), updatedAt: at } : item));
	}

	async function note(record: ScheduleRunRecord): Promise<void> {
		await appendRun(options.partnerDir, record);
		ledger.push(record);
	}

	async function tick(): Promise<void> {
		if (running) return;
		running = true;
		try {
			const at = now();
			definitions = reapZombies(definitions, at);
			const plan = duePlan(definitions, at);
			const records = await readRuns(options.partnerDir);
			ledger = records;
			let inFlight = definitions.filter((item) => item.running).length;

			for (const fire of plan.fires) {
				if (inFlight >= maxConcurrent) {
					withNext(fire.id, at);
					await note({
						runId: fire.runId,
						scheduleId: fire.id,
						scheduledAt: fire.scheduledAt,
						dispatchedAt: null,
						trigger: fire.trigger,
						status: "skipped",
						attempts: fire.retry,
						error: "concurrency",
					});
					continue;
				}
				if (runsToday(records, at) >= dailyCap) {
					withNext(fire.id, at, { enabled: false, lifecycleStatus: "paused", running: false, claimedAt: null });
					await note({
						runId: fire.runId,
						scheduleId: fire.id,
						scheduledAt: fire.scheduledAt,
						dispatchedAt: null,
						trigger: fire.trigger,
						status: "skipped",
						attempts: fire.retry,
						error: "daily-cap",
					});
					continue;
				}
				inFlight += 1;
				const definition = definitions.find((item) => item.id === fire.id);
				if (!definition) continue;
				definitions = definitions.map((item) => (item.id === fire.id ? applyFire(item, fire, at) : item));
				try {
					await options.dispatch(fire);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (error instanceof ScheduleBusyError) {
						definitions = definitions.map((item) =>
							item.id === fire.id ? { ...item, running: false, claimedAt: null, attempts: 0, retryAt: null, runCount: Math.max(0, item.runCount - 1), updatedAt: at } : item,
						);
						await note({
							runId: fire.runId,
							scheduleId: fire.id,
							scheduledAt: fire.scheduledAt,
							dispatchedAt: null,
							trigger: fire.trigger,
							status: "skipped",
							attempts: 0,
							error: message,
						});
						continue;
					}
					const config = error instanceof ScheduleConfigError;
					definitions = definitions.map((item) => (item.id === fire.id ? (config ? applyConfigFailure(item, message, at) : applyFailure(item, message, at)) : item));
					await note({
						runId: fire.runId,
						scheduleId: fire.id,
						scheduledAt: fire.scheduledAt,
						dispatchedAt: at,
						trigger: fire.trigger,
						status: "failed",
						attempts: fire.retry,
						error: message,
					});
				}
			}

			for (const miss of plan.missed) {
				if (!definitions.some((item) => item.id === miss.id)) continue;
				definitions = definitions.map((item) => (item.id === miss.id ? applyMiss(item, miss, at) : item));
				await note({ runId: miss.runId, scheduleId: miss.id, scheduledAt: miss.scheduledAt, dispatchedAt: null, trigger: "schedule", status: "missed", attempts: 0 });
			}

			await saveSchedules(options.partnerDir, definitions);
			options.onChange?.(definitions);
		} finally {
			running = false;
			arm();
		}
	}

	return {
		tick,
		definitions: () => definitions,
		async settle(id: string, status: "done" | "failed", details: { runId?: string; error?: string; sessionId?: string } = {}): Promise<void> {
			const at = now();
			if (!definitions.some((item) => item.id === id)) return;
			definitions = settle(definitions, id, at);
			await saveSchedules(options.partnerDir, definitions);
			const records = await readRuns(options.partnerDir);
			const settled = new Set(records.filter((record) => record.status !== "dispatched").map((record) => record.runId));
			const open = details.runId
				? records.find((record) => record.runId === details.runId)
				: [...records].reverse().find((record) => record.scheduleId === id && record.status === "dispatched" && !settled.has(record.runId));
			if (!open) return;
			const record: ScheduleRunRecord = { ...open, status, dispatchedAt: open.dispatchedAt ?? at, ...details };
			await note(record);
			options.onSettle?.(record);
			options.onChange?.(definitions);
		},
		async noteDispatched(fire: DueFire): Promise<void> {
			await note({ runId: fire.runId, scheduleId: fire.id, scheduledAt: fire.scheduledAt, dispatchedAt: now(), trigger: fire.trigger, status: "dispatched", attempts: fire.retry });
		},
		stop() {
			if (timer) clearTimeout(timer);
			timer = null;
			const held = definitions.filter((item) => item.running);
			if (held.length === 0) return;
			definitions = held.reduce((list, item) => settle(list, item.id, now()), definitions);
			saveSchedulesSync(options.partnerDir, definitions);
		},
		async update(mutate: (items: ScheduleDefinition[]) => ScheduleDefinition[]): Promise<ScheduleDefinition[]> {
			const at = now();
			definitions = mutate(definitions).map((item) => ({ ...item, updatedAt: at }));
			await saveSchedules(options.partnerDir, definitions);
			options.onChange?.(definitions);
			arm();
			return definitions;
		},
		async start(): Promise<void> {
			definitions = reconcile(await loadSchedules(options.partnerDir), now());
			if (definitions.length > 0 || (await hasSchedules(options.partnerDir))) await saveSchedules(options.partnerDir, definitions);
			options.onChange?.(definitions);
			arm();
		},
	};
}

export function createDefinitionId(): string {
	return `s${randomUUID().slice(0, 8)}`;
}
