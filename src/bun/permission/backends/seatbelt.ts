/**
 * The macOS backend (Seatbelt) behind the SandboxManager.
 *
 * Generates a dynamic SBPL profile per wrap call — `sandbox-exec -p '<profile>' -- argv`.
 * Fail closed: if the binary is missing or refuses the profile, `probe()` returns false
 * and the manager throws SANDBOX_UNAVAILABLE; a confined command never runs unconfined.
 */
import { spawnSync } from "node:child_process";
import { writableRoots } from "../roots";
import type { ConfinedArgv, PermissionPolicy, SandboxBackend } from "../types";

const SEATBELT = "/usr/bin/sandbox-exec";

/** Seatbelt's stderr line on a denied file effect (EPERM). */
export const SEATBELT_DENIAL_SIGNATURES = ["operation not permitted"];
/** stderr evidence the runner itself failed before exec (the command never ran). */
export const SEATBELT_RUNNER_FAILURE_RULES = ["sandbox-exec: "];

function sbplEscape(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * The SBPL profile arguments for a policy.
 * read-only → only the /dev/null sink; workspace-write → one subpath grant per writable root.
 */
export function seatbeltProfileArgs(policy: PermissionPolicy): string[] {
	const forms = ["(version 1)", "(allow default)", "(deny file-write*)", '(allow file-write* (literal "/dev/null"))'];
	const roots = writableRoots(policy);
	if (roots.length > 0) {
		const subpaths = roots.map((r) => `(subpath "${sbplEscape(r)}")`).join(" ");
		forms.push(`(allow file-write* ${subpaths})`);
	}
	return ["-p", forms.join(" ")];
}

const PROBE_PROFILE = ["-p", '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null"))'];

export const seatbeltBackend: SandboxBackend = {
	id: "seatbelt",
	platforms: ["darwin"],
	probe(): boolean {
		if (process.platform !== "darwin") return false;
		try {
			const res = spawnSync(SEATBELT, [...PROBE_PROFILE, "--", "true"], { stdio: "ignore" });
			return res.status === 0;
		} catch {
			return false;
		}
	},
	confine(argv: string[], policy: PermissionPolicy): ConfinedArgv {
		return {
			argv: [SEATBELT, ...seatbeltProfileArgs(policy), "--", ...argv],
			enforcement: "full",
			denialSignatures: SEATBELT_DENIAL_SIGNATURES,
			runnerFailureRules: SEATBELT_RUNNER_FAILURE_RULES,
		};
	},
};
