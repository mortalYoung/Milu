import { Cron } from "croner";

import { JITTER_CALENDAR_MS, JITTER_INTERVAL_MS, MAX_ACTIVE, MIN_AGENT_INTERVAL_MS, type ScheduleDefinition, type ScheduleRule } from "./store.ts";

function parseCron(expression: string): Cron | null {
	try {
		return new Cron(expression, { paused: true });
	} catch {
		return null;
	}
}

export function nextIntervalAt(anchor: number, everyMs: number, from: number): number {
	if (from <= anchor) return anchor;
	return anchor + (Math.floor((from - anchor) / everyMs) + 1) * everyMs;
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

export function jitterFor(id: string, span: number): number {
	let hash = 2166136261;
	for (let at = 0; at < id.length; at += 1) {
		hash ^= id.charCodeAt(at);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % Math.max(1, span);
}

/** Deterministic per-schedule offset, so a pile of schedules created together does not fire together. */
export function advanceNext(id: string, rule: ScheduleRule, from: number, jitter: boolean): number | null {
	const base = nextFire(rule, from);
	if (base === null) return null;
	if (!jitter || rule.kind === "once") return base;
	return base + jitterFor(id, rule.kind === "interval" ? JITTER_INTERVAL_MS : JITTER_CALENDAR_MS);
}

export function describeRule(rule: ScheduleRule): string {
	if (rule.kind === "once") return `once · ${stamp(rule.at)}`;
	if (rule.kind === "interval") return `every ${intervalLabel(rule.everyMs)}`;
	const parts = rule.expression.trim().split(/\s+/);
	const [minute, hour] = parts;
	if (parts.length === 5 && minute === "0" && /^\d+$/.test(hour ?? "")) return `daily ${hour?.padStart(2, "0")}:00`;
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
	readonly rule?: ScheduleRule;
	readonly describe?: string;
	readonly error?: string;
}

/** The clock a model may write: a 5-field cron expression in local time, nothing else. */
export function parseCronWhen(when: string, now: number): ParsedWhen {
	const expression = when
		.trim()
		.replace(/^cron:/i, "")
		.replace(/\s+/g, " ");
	if (expression.split(" ").length !== 5 || !/^[\d*/,\-\s]+$/.test(expression)) return { error: `"${when.trim()}" is not a 5-field cron expression` };

	const cron = parseCron(expression);
	const first = cron?.nextRun(new Date(now)) ?? null;
	cron?.stop();
	if (!first) return { error: `"${expression}" never fires` };

	const rule: ScheduleRule = { kind: "cron", expression };
	return { rule, describe: describeRule(rule) };
}

/** What the model may put on the clock: bounded in count, and never faster than a human could keep up with. */
export function checkAgentCreate(definitions: readonly ScheduleDefinition[], rule: ScheduleRule, now: number): string | null {
	const active = definitions.filter((item) => item.enabled && item.lifecycleStatus === "active").length;
	if (active >= MAX_ACTIVE) return `this chat already has ${MAX_ACTIVE} active schedules`;

	const first = nextFire(rule, now);
	if (first === null) return "that time is already past";
	const second = nextFire(rule, first + 1000);
	if (second !== null && second - first < MIN_AGENT_INTERVAL_MS) return "the fastest I may schedule is every 15 minutes";
	return null;
}
