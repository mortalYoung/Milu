import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { BootMark } from "@milu/protocol";
import { app } from "electron";

const ORIGIN = Date.now() - performance.now();
const LOG_DIR = logDir();
const LOG_FILE = join(LOG_DIR, `${stamp(new Date(ORIGIN))}.log`);
const HOLD_MS = 3000;
const LIMIT_MS = 20000;

function stamp(at: Date): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
}

function logDir(): string {
	const configured = process.env["MILU_LOG_DIR"];
	if (configured) return configured;
	for (let dir = app.getAppPath(); ;) {
		const parent = dirname(dir);
		if (parent === dir) return join(process.cwd(), ".logs");
		if (existsSync(join(parent, "bun.lock"))) return join(parent, ".logs");
		dir = parent;
	}
}

const marks = new Map<string, number>([["start", ORIGIN]]);
let heard = false;
let printed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function bootMark(name: string): void {
	if (marks.has(name)) return;
	marks.set(name, Date.now());
	settle();
}

export function recordBootMarks(reported: readonly BootMark[]): void {
	for (const mark of reported) if (!marks.has(mark.name)) marks.set(mark.name, mark.at);
	heard = true;
	settle();
}

function settle(): void {
	if (printed) return;
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	if (heard && marks.has("ready")) {
		print();
		return;
	}
	timer = setTimeout(print, heard ? HOLD_MS : LIMIT_MS).unref();
}

function print(): void {
	if (printed) return;
	printed = true;
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	const elapsed = (at: number): string => `${Math.round(at - ORIGIN)}ms`;
	const pick = (name: string): string => {
		const at = marks.get(name) ?? (name === "data" ? marks.get("list") : undefined);
		return at === undefined ? "—" : elapsed(at);
	};
	const timeline = [...marks.entries()].sort((left, right) => left[1] - right[1]).map(([name, at]) => `${name} ${elapsed(at)}`);
	const lines = [`[boot] ${timeline.join(" · ")}`, `[boot] saw data ${pick("data")} · operable ${pick("interactive")} · complete ${elapsed(Math.max(...marks.values()))}`];
	for (const line of lines) console.log(line);
	void mkdir(LOG_DIR, { recursive: true })
		.then(() => appendFile(LOG_FILE, `${lines.join("\n")}\n`, "utf8"))
		.catch((error: unknown) => console.error("[boot] log failed", error));
}
