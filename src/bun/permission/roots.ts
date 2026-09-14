/**
 * Shared root derivation — ONE place feeding both the kernel profile and the in-process
 * fs fence (the invariant that keeps bash and fs tools from drifting apart), plus the
 * path-containment helper both sides test with.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { PermissionPolicy } from "./types";

/**
 * Canonicalize a root the way Seatbelt matches it: symlink-resolved absolute path.
 * A nonexistent root is granted as spelled (it matches nothing until it exists —
 * the conservative outcome). On macOS /tmp resolves to /private/tmp, so an as-spelled
 * grant would silently match nothing.
 */
export function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** Path containment: target is the root itself or under it. */
export function isInside(target: string, root: string): boolean {
	return target === root || target.startsWith(root + sep);
}

export function isInsideAny(target: string, roots: string[]): boolean {
	return roots.some((root) => isInside(target, root));
}

function nearestDotGit(start: string): string | null {
	let dir = resolve(start);
	for (;;) {
		const candidate = join(dir, ".git");
		try {
			statSync(candidate);
			return candidate;
		} catch {
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	}
}

/**
 * The git metadata a command in `workspace` may also write, found the way git finds it: the
 * nearest `.git` walking up from the workspace. A plain repo keeps it inside the workspace
 * (nothing to add); a worktree has a `.git` file pointing at the main repo's
 * `.git/worktrees/<name>`, whose `commondir` names the shared store (objects/refs) — both are
 * outside the workspace, and git writes to both.
 */
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
	} catch {
		// pre-worktree git keeps everything in the gitdir itself
	}
	return roots;
}

/** The writable roots a confined command may write under `workspace-write` (canonicalized + deduped). */
export function writableRoots(policy: PermissionPolicy): string[] {
	if (policy.mode !== "workspace-write") return [];
	const roots = [policy.workspace, policy.storage, ...gitRoots(policy.workspace), "/tmp", tmpdir()].filter((r): r is string => r != null && r !== "");
	return [...new Set(roots.map(canonicalPath))];
}
