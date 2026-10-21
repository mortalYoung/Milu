import type { SandboxMode } from "@milu/core";

const RANK: Record<SandboxMode, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };

export function isStrictlyWider(from: SandboxMode, to: SandboxMode): boolean {
	return RANK[to] > RANK[from];
}
