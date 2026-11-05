import { readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import type { PermissionPolicy } from "./types.ts";

function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function nearestDotGit(start: string): string | null {
	let dir = resolve(start);
	for (;;) {
		try {
			statSync(join(dir, ".git"));
			return join(dir, ".git");
		} catch {
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	}
}

export function gitRoots(workspace: string | null): string[] {
	if (workspace === null || workspace === "") return [];
	const dotGit = nearestDotGit(workspace);
	if (dotGit === null) return [];
	let isPointer = false;
	try {
		isPointer = statSync(dotGit).isFile();
	} catch {
		return [];
	}
	if (!isPointer) return [dotGit];
	let pointer: string | null = null;
	try {
		const match = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(dotGit, "utf8"));
		pointer = match === null ? null : match[1].trim();
	} catch {
		return [];
	}
	if (pointer === null || pointer === "") return [];
	const gitDir = resolve(dirname(dotGit), pointer);
	const roots = [gitDir];
	try {
		const common = readFileSync(join(gitDir, "commondir"), "utf8").trim();
		if (common !== "") roots.push(resolve(gitDir, common));
	} catch {}
	return roots;
}

export function writableRoots(policy: PermissionPolicy): string[] {
	if (policy.mode !== "workspace-write") return [];
	const roots = [policy.workspace, policy.storage, policy.trash, ...(policy.write ?? []), ...gitRoots(policy.workspace), "/tmp", tmpdir()].filter(
		(root): root is string => root !== null && root !== "",
	);
	return [...new Set(roots.map(canonicalPath))];
}

export function isInside(target: string, root: string): boolean {
	return target === root || target.startsWith(root + sep);
}

export function isInsideAny(target: string, roots: string[]): boolean {
	return roots.some((root) => isInside(target, root));
}

export function isInsideWriteRoots(target: string, policy: PermissionPolicy): boolean {
	return isInsideAny(target, (policy.write ?? []).map(canonicalPath));
}
