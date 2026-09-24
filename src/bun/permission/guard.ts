import { basename } from "node:path";
import { gitRoots, isInside, isInsideAny } from "./roots";
import type { PermissionCode, PermissionDecision, PermissionPolicy } from "./types";

const SENSITIVE_PATTERNS: RegExp[] = [/^\.env(?:\.\w+)?$/, /\.pem$/, /\.key$/, /^id_rsa$/, /^id_ed25519$/, /^\.git-credentials$/, /^\.npmrc$/];

export function isSensitiveName(name: string): boolean {
	return SENSITIVE_PATTERNS.some((p) => p.test(name));
}

export function commandMentionsSensitive(command: string): boolean {
	return /(?:^|[^A-Za-z0-9_./-])(?:\.env(?:\.\w+)?|[\w./-]*\.(?:pem|key)|id_rsa|id_ed25519|\.git-credentials|\.npmrc)(?:$|[^A-Za-z0-9_./-])/.test(command);
}

export const sandboxDenialMarker = (mode: string) => `[sandbox: file access denied under ${mode} mode]`;

export const ALLOWED: PermissionDecision = { allowed: true };
export const deny = (code: PermissionCode, reason: string): PermissionDecision => ({ allowed: false, code, reason });

export function checkPath(target: string, op: "read" | "write", policy: PermissionPolicy, sandboxMounted: boolean): PermissionDecision {
	const storage = policy.storage;
	if (storage && isInside(target, storage)) return ALLOWED; // storage: full access, sensitive files allowed
	if (isSensitiveName(basename(target))) return deny("sensitive_file", "Sensitive file access is not allowed (except inside the storage path)");
	if (op === "write") {
		const workspace = policy.workspace ?? policy.storage;
		if (policy.trash && isInside(target, policy.trash)) return ALLOWED;
		if (workspace && !isInside(target, workspace) && !isInsideAny(target, gitRoots(policy.workspace))) {
			return deny("outside_workspace", policy.workspace ? "Path is outside the working directory and the storage path" : "Path is outside the storage path");
		}
		if (sandboxMounted && policy.mode === "read-only") return deny("read_only_write", "[sandbox: write denied under read-only mode]");
	}
	return ALLOWED;
}
