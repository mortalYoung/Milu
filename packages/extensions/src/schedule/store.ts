import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SCHEMA_VERSION = 1;
export const MISFIRE_GRACE_MS = 5 * 60_000;
export const MIN_INTERVAL_MS = 60_000;
export const MAX_ACTIVE = 20;
export const MIN_AGENT_INTERVAL_MS = 15 * 60_000;
export const JITTER_CALENDAR_MS = 15_000;
export const JITTER_INTERVAL_MS = 60_000;

export type ScheduleStatus = "active" | "paused" | "finished";

export type ScheduleRule =
	| { readonly kind: "once"; readonly at: number }
	| { readonly kind: "interval"; readonly anchor: number; readonly everyMs: number }
	| { readonly kind: "cron"; readonly expression: string };

export interface ScheduleDefinition {
	readonly id: string;
	readonly schemaVersion: number;
	readonly title: string;
	readonly display: string;
	readonly schedule: ScheduleRule;
	readonly payload: { readonly kind: "prompt"; readonly text: string };
	readonly workspaceIdentity: string | null;
	readonly enabled: boolean;
	readonly lifecycleStatus: ScheduleStatus;
	nextRunAt: number | null;
	runCount: number;
	readonly createdAt: number;
	updatedAt: number;
	readonly createdBy: "user" | "agent";
}

/** A configuration failure cannot heal by repeating it: stop the schedule and say why. */
export class ScheduleConfigError extends Error {}

export type RunStatus = "dispatched" | "skipped" | "missed";

export interface RunRecord {
	readonly runId: string;
	readonly scheduleId: string;
	readonly scheduledAt: number;
	readonly dispatchedAt: number | null;
	readonly trigger: "schedule" | "manual" | "catchup";
	readonly status: RunStatus;
	readonly error?: string;
}

const RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>(["dispatched", "skipped", "missed"]);

function dir(sessionRoot: string): string {
	return join(sessionRoot, "schedules");
}

function definitionsPath(sessionRoot: string): string {
	return join(dir(sessionRoot), "tasks.json");
}

function runsPath(sessionRoot: string): string {
	return join(dir(sessionRoot), "runs.jsonl");
}

function isDefinition(value: unknown): value is ScheduleDefinition {
	const record = value as ScheduleDefinition | null;
	return Boolean(record && typeof record.id === "string" && typeof record.schedule === "object" && record.schedule !== null);
}

export async function hasDefinitions(sessionRoot: string): Promise<boolean> {
	return access(definitionsPath(sessionRoot)).then(
		() => true,
		() => false,
	);
}

export async function loadDefinitions(sessionRoot: string): Promise<ScheduleDefinition[]> {
	const text = await readFile(definitionsPath(sessionRoot), "utf8").catch(() => null);
	if (text === null) return [];
	try {
		const parsed = JSON.parse(text) as { tasks?: unknown };
		return Array.isArray(parsed.tasks) ? parsed.tasks.filter(isDefinition) : [];
	} catch {
		return [];
	}
}

export async function saveDefinitions(sessionRoot: string, definitions: readonly ScheduleDefinition[]): Promise<void> {
	await mkdir(dir(sessionRoot), { recursive: true });
	const target = definitionsPath(sessionRoot);
	const temp = `${target}.tmp`;
	await writeFile(temp, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, tasks: definitions }, null, 2)}\n`, "utf8");
	await rename(temp, target);
}

export async function appendRun(sessionRoot: string, record: RunRecord): Promise<void> {
	await mkdir(dir(sessionRoot), { recursive: true });
	await appendFile(runsPath(sessionRoot), `${JSON.stringify(record)}\n`, "utf8");
}

export async function readRuns(sessionRoot: string): Promise<RunRecord[]> {
	const text = await readFile(runsPath(sessionRoot), "utf8").catch(() => null);
	if (text === null) return [];
	return text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.flatMap((line) => {
			try {
				const record = JSON.parse(line) as RunRecord;
				const status = (record as { status?: unknown }).status;
				return [{ ...record, status: typeof status === "string" && RUN_STATUSES.has(status) ? status : "dispatched" } as RunRecord];
			} catch {
				return [];
			}
		});
}

export function runsToday(records: readonly RunRecord[], now: number): number {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	return records.filter((record) => record.status !== "missed" && record.status !== "skipped" && (record.dispatchedAt ?? record.scheduledAt) >= start.getTime()).length;
}

export function newDefinition(input: {
	readonly id: string;
	readonly title: string;
	readonly display: string;
	readonly schedule: ScheduleRule;
	readonly text: string;
	readonly workspaceIdentity: string | null;
	readonly now: number;
	readonly createdBy: "user" | "agent";
	readonly nextRunAt: number | null;
}): ScheduleDefinition {
	return {
		id: input.id,
		schemaVersion: SCHEMA_VERSION,
		title: input.title,
		display: input.display,
		schedule: input.schedule,
		payload: { kind: "prompt", text: input.text },
		workspaceIdentity: input.workspaceIdentity,
		enabled: true,
		lifecycleStatus: "active",
		nextRunAt: input.nextRunAt,
		runCount: 0,
		createdAt: input.now,
		updatedAt: input.now,
		createdBy: input.createdBy,
	};
}
