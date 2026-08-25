/**
 * Shared root derivation — ONE place feeding both the kernel profile and the in-process
 * fs fence (the invariant that keeps bash and fs tools from drifting apart), plus the
 * path-containment helper both sides test with.
 */
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { sep } from "node:path";
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

/** The writable roots a confined command may write under `workspace-write` (canonicalized + deduped). */
export function writableRoots(policy: PermissionPolicy): string[] {
	if (policy.mode !== "workspace-write") return [];
	const roots = [policy.workspace, policy.storage, "/tmp", tmpdir()].filter((r): r is string => r != null && r !== "");
	return [...new Set(roots.map(canonicalPath))];
}
