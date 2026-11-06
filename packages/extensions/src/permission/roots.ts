import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

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

function canonicalCandidate(path: string): string {
	let current = path;
	const tail: string[] = [];
	for (;;) {
		try {
			return [realpathSync(current), ...tail].join(sep);
		} catch {
			const parent = dirname(current);
			if (parent === current) return path;
			tail.unshift(basename(current));
			current = parent;
		}
	}
}

const EXEMPT_DENIED = ["/System", "/Library", "/Applications", "/bin", "/sbin", "/usr", "/etc", "/private", "/var", "/tmp", "/Volumes", "/cores", "/Network"];

function deniedRoots(): string[] {
	const home = homedir();
	return [
		...EXEMPT_DENIED,
		join(home, "Library"),
		join(home, "Library", "Keychains"),
		join(home, "Library", "Application Support"),
		join(home, ".config"),
		join(home, ".cache"),
		join(home, ".local"),
		join(home, ".ssh"),
		join(home, ".gnupg"),
		join(home, ".aws"),
		join(home, ".kube"),
		join(home, ".Trash"),
		join(home, "Desktop"),
		join(home, "Documents"),
		join(home, "Downloads"),
		join(home, "Movies"),
		join(home, "Music"),
		join(home, "Pictures"),
	];
}

export function resolveExemptRoot(value: string): string {
	if (value === "" || !isAbsolute(value)) throw new Error(`settings "sandboxExemptRoot" must be an absolute path, got "${value}"`);
	const path = canonicalCandidate(resolve(value));
	const home = canonicalPath(homedir());
	if (path === "/" || path === home) throw new Error(`settings "sandboxExemptRoot" must not be ${path}`);
	for (const denied of deniedRoots()) {
		const root = canonicalPath(denied);
		if (root === "/") continue;
		if (isInside(path, root)) throw new Error(`settings "sandboxExemptRoot" must not be inside ${denied}`);
		if (isInside(root, path)) throw new Error(`settings "sandboxExemptRoot" must not cover ${denied}`);
	}
	return path;
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
