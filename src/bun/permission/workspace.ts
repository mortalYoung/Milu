/**
 * Workspace boundary rules + the persisted policy file locations.
 * validateWorkspace is the policy-change resolution for set_workspace; the file
 * paths are the policy's persisted state (per partner), so they live with the policy.
 */
import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isInside } from "./roots";

export const workspaceFilePath = (dir: string) => join(dir, "workspace.json");
export const sandboxFilePath = (dir: string) => join(dir, "sandbox.json");

/** set_workspace boundary validation: once per conversation, absolute, exists, outside storage. */
export function validateWorkspace(workspace: string, state: { current: string | null; storagePath: string | null }): string | null {
	if (state.current) return "Workspace can only be set once per conversation";
	if (!isAbsolute(workspace)) return "Workspace must be an absolute path";
	const abs = resolve(workspace);
	if (state.storagePath && isInside(abs, state.storagePath)) return "Workspace cannot be inside the storage path";
	try {
		if (!statSync(abs).isDirectory()) return "Workspace path is not a directory";
	} catch {
		return "Workspace directory does not exist";
	}
	return null;
}
