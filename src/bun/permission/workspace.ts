import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isInside } from "./roots";

export const workspaceFilePath = (dir: string) => join(dir, "workspace.json");
export const sandboxFilePath = (dir: string) => join(dir, "sandbox.json");

export function validateWorkspace(workspace: string, state: { storagePath: string | null }): string | null {
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
