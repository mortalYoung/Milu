/**
 * Mode policy — the mode vocabulary, its ordering, and escalation width.
 * isStrictlyWider and widerModes are one policy (the same rank table), defined here once.
 */
import type { SandboxMode } from "./types";

export const SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

export function isSandboxMode(value: unknown): value is SandboxMode {
	return typeof value === "string" && (SANDBOX_MODES as string[]).includes(value);
}

/** Strictly-wider ordering for escalation: read-only < workspace-write < danger-full-access. */
const MODE_RANK: Record<SandboxMode, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };

export function isStrictlyWider(from: SandboxMode, to: SandboxMode): boolean {
	return MODE_RANK[to] > MODE_RANK[from];
}

/** Modes strictly wider than the current one (escalation may only go wider). */
export function widerModes(mode: SandboxMode): SandboxMode[] {
	return SANDBOX_MODES.filter((m) => isStrictlyWider(mode, m));
}
