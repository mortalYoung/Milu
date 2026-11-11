import type { SpriteState } from "./sheets.ts";

export interface Signals {
	readonly running: boolean;
	readonly waiting: number;
	readonly error: string | null;
}

export function stateOf(signals: Signals): SpriteState {
	if (signals.error !== null) return "failed";
	if (signals.waiting > 0) return "waiting";
	if (signals.running) return "running";
	return "idle";
}
