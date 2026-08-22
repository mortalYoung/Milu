import { statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

export function isInsideOf(target: string, root: string): boolean {
	return target === root || target.startsWith(root + sep);
}

export function validateWorkspace(workspace: string, state: { current: string | null; storagePath: string | null }): string | null {
	if (state.current) return "Workspace can only be set once per conversation";
	if (!isAbsolute(workspace)) return "Workspace must be an absolute path";
	const abs = resolve(workspace);
	if (state.storagePath && isInsideOf(abs, state.storagePath)) return "Workspace cannot be inside the storage path";
	try {
		if (!statSync(abs).isDirectory()) return "Workspace path is not a directory";
	} catch {
		return "Workspace directory does not exist";
	}
	return null;
}
