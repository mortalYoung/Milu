/**
 * Policy resolution — the one place the run's inputs become an effective
 * PermissionPolicy (per call, so workspace/mode changes apply immediately).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { PermissionPolicy, SandboxMode } from "./types";

export function policyFor(workspace: string | null, storage: string | null, mode: SandboxMode, trash: string | null = join(homedir(), ".Trash")): PermissionPolicy {
	return { workspace, storage, trash, mode };
}
