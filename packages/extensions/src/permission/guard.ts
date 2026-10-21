import { basename } from "node:path";

import { gitRoots, isInside, isInsideAny } from "./roots.ts";
import type { PermissionCode, PermissionDecision, PermissionPolicy } from "./types.ts";

const SENSITIVE_NAMES: RegExp[] = [/^\.env(?:\.\w+)?$/, /\.pem$/, /\.key$/, /^id_rsa$/, /^id_ed25519$/, /^\.git-credentials$/, /^\.npmrc$/];

const SENSITIVE_COMMAND = /(?:^|[^A-Za-z0-9_./-])(?:\.env(?:\.\w+)?|[\w./-]*\.(?:pem|key)|id_rsa|id_ed25519|\.git-credentials|\.npmrc)(?:$|[^A-Za-z0-9_./-])/;

const ALLOWED: PermissionDecision = { allowed: true };

function deny(code: PermissionCode, reason: string): PermissionDecision {
	return { allowed: false, code, reason };
}

export function isSensitiveName(name: string): boolean {
	return SENSITIVE_NAMES.some((pattern) => pattern.test(name));
}

export function commandMentionsSensitive(command: string): boolean {
	return SENSITIVE_COMMAND.test(command);
}

export function checkPath(target: string, op: "read" | "write", policy: PermissionPolicy, sandboxMounted: boolean): PermissionDecision {
	if (isInside(target, policy.storage)) return ALLOWED;
	if (isSensitiveName(basename(target))) return deny("sensitive_file", "Sensitive file access is not allowed (except inside the storage path)");
	if (op === "write") {
		const workspace = policy.workspace ?? policy.storage;
		if (isInside(target, policy.trash)) return ALLOWED;
		if (!isInside(target, workspace) && !isInsideAny(target, gitRoots(policy.workspace))) {
			return deny("outside_workspace", policy.workspace ? "Path is outside the working directory and the storage path" : "Path is outside the storage path");
		}
		if (sandboxMounted && policy.mode === "read-only") return deny("read_only_write", "[sandbox: write denied under read-only mode]");
	}
	return ALLOWED;
}

export function sandboxDenialMarker(mode: string): string {
	return `[sandbox: file access denied under ${mode} mode]`;
}
