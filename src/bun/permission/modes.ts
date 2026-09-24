import type { SandboxMode } from "./types";

export const SANDBOX_MODES: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

export function isSandboxMode(value: unknown): value is SandboxMode {
	return typeof value === "string" && (SANDBOX_MODES as string[]).includes(value);
}

const MODE_RANK: Record<SandboxMode, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };

export function isStrictlyWider(from: SandboxMode, to: SandboxMode): boolean {
	return MODE_RANK[to] > MODE_RANK[from];
}

export function widerModes(mode: SandboxMode): SandboxMode[] {
	return SANDBOX_MODES.filter((m) => isStrictlyWider(mode, m));
}
