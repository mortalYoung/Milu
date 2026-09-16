/**
 * In-process guards — the permission decisions that don't need the kernel:
 * sensitive-name blocking, the bash command scan, and the fs fence. Denial
 * texts are byte-identical to what the model has always seen; each carries a code.
 */
import { basename } from "node:path";
import { gitRoots, isInside, isInsideAny } from "./roots";
import type { PermissionCode, PermissionDecision, PermissionPolicy } from "./types";

/** Sensitive filenames: never readable/writable outside the storage path. */
const SENSITIVE_PATTERNS: RegExp[] = [/^\.env(?:\.\w+)?$/, /\.pem$/, /\.key$/, /^id_rsa$/, /^id_ed25519$/, /^\.git-credentials$/, /^\.npmrc$/];

export function isSensitiveName(name: string): boolean {
	return SENSITIVE_PATTERNS.some((p) => p.test(name));
}

/** Best-effort scan for sensitive files in a shell command (defense-in-depth; the kernel is the boundary). */
export function commandMentionsSensitive(command: string): boolean {
	return /(?:^|[^A-Za-z0-9_./-])(?:\.env(?:\.\w+)?|[\w./-]*\.(?:pem|key)|id_rsa|id_ed25519|\.git-credentials|\.npmrc)(?:$|[^A-Za-z0-9_./-])/.test(command);
}

/** The denial marker for a kernel-denied write — one source of truth for the `[sandbox: …]` language. */
export const sandboxDenialMarker = (mode: string) => `[sandbox: file access denied under ${mode} mode]`;

export const ALLOWED: PermissionDecision = { allowed: true };
export const deny = (code: PermissionCode, reason: string): PermissionDecision => ({ allowed: false, code, reason });

/**
 * The fs fence: judge an absolute target path against the policy.
 * Reads are unrestricted (any location) except sensitive names — the sandbox seam never
 * confined reads (Seatbelt denies file-write* only), so the fs fence matches the kernel.
 * The read-only mode only bites when a confining backend is mounted (sandboxMounted),
 * mirroring the pre-facade behavior: without a backend, read-only is a nominal mode.
 */
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
