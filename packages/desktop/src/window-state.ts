import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface WindowFrame {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface WindowState {
	readonly frame: WindowFrame;
	readonly maximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
	frame: { x: 120, y: 60, width: 1200, height: 800 },
	maximized: false,
};

export const WINDOW_MIN = { width: 560, height: 480 };

const SAVED_MIN = { width: 480, height: 320 };
const FILE = "last-session.json";

function statePath(root: string): string {
	return join(root, FILE);
}

function isFrame(value: unknown): value is WindowFrame {
	if (typeof value !== "object" || value === null) return false;
	const frame = value as Record<string, unknown>;
	const numbers = [frame["x"], frame["y"], frame["width"], frame["height"]];
	if (!numbers.every((each) => typeof each === "number" && Number.isFinite(each))) return false;
	return (frame["width"] as number) >= SAVED_MIN.width && (frame["height"] as number) >= SAVED_MIN.height;
}

export function readRememberSession(root: string): boolean {
	try {
		const raw: unknown = JSON.parse(readFileSync(join(root, "settings.json"), "utf8"));
		const value = typeof raw === "object" && raw !== null ? (raw as { rememberSession?: unknown }).rememberSession : undefined;
		return value !== false;
	} catch {
		return true;
	}
}

export function readWindowState(root: string): WindowState | null {
	try {
		const value: unknown = JSON.parse(readFileSync(statePath(root), "utf8"));
		if (typeof value !== "object" || value === null) return null;
		const state = value as { frame?: unknown; maximized?: unknown };
		if (!isFrame(state.frame)) return null;
		return { frame: state.frame, maximized: state.maximized === true };
	} catch {
		return null;
	}
}

export function writeWindowState(root: string, state: WindowState): void {
	try {
		mkdirSync(dirname(statePath(root)), { recursive: true });
		writeFileSync(statePath(root), `${JSON.stringify(state, null, "\t")}\n`);
	} catch (error) {
		console.error("[milu] window state write failed", error);
	}
}
