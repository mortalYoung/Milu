import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface WindowFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LastSession {
	frame: WindowFrame;
	maximized: boolean;
	partner: string | null;
}

const STATE_PATH = join(homedir(), ".config", "letters", "last-session.json");
const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;

function isFrame(value: unknown): value is WindowFrame {
	if (typeof value !== "object" || value === null) return false;
	const frame = value as Record<string, unknown>;
	return [frame["x"], frame["y"], frame["width"], frame["height"]].every((n) => typeof n === "number" && Number.isFinite(n));
}

export function readLastSession(): LastSession | null {
	try {
		const state: unknown = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		if (typeof state !== "object" || state === null) return null;
		const { frame, maximized, partner } = state as { frame?: unknown; maximized?: unknown; partner?: unknown };
		if (!isFrame(frame) || frame.width < MIN_WIDTH || frame.height < MIN_HEIGHT) return null;
		return { frame, maximized: maximized === true, partner: typeof partner === "string" && partner !== "" ? partner : null };
	} catch {
		return null;
	}
}

export function writeLastSession(state: LastSession): void {
	try {
		mkdirSync(dirname(STATE_PATH), { recursive: true });
		writeFileSync(STATE_PATH, `${JSON.stringify(state, null, "\t")}\n`);
	} catch (error) {
		console.error("last session write failed:", error);
	}
}

export function clearLastSession(): void {
	try {
		rmSync(STATE_PATH, { force: true });
	} catch (error) {
		console.error("last session clear failed:", error);
	}
}
