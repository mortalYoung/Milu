/**
 * Policy resolution — the one place the run's inputs become an effective
 * PermissionPolicy (per call, so workspace/mode changes apply immediately).
 */
import type { PermissionPolicy, SandboxMode } from "./types";

export function policyFor(workspace: string | null, storage: string | null, mode: SandboxMode): PermissionPolicy {
	return { workspace, storage, mode };
}
