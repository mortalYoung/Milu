import { spawnSync } from "node:child_process";
import { writableRoots } from "../roots";
import type { ConfinedArgv, PermissionPolicy, SandboxBackend } from "../types";

const SEATBELT = "/usr/bin/sandbox-exec";

export const SEATBELT_DENIAL_SIGNATURES = ["operation not permitted"];
export const SEATBELT_RUNNER_FAILURE_RULES = ["sandbox-exec: "];

function sbplEscape(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

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
	async confine(argv: string[], policy: PermissionPolicy): Promise<ConfinedArgv> {
		return {
			argv: [SEATBELT, ...seatbeltProfileArgs(policy), "--", ...argv],
			enforcement: "full",
			denialSignatures: SEATBELT_DENIAL_SIGNATURES,
			runnerFailureRules: SEATBELT_RUNNER_FAILURE_RULES,
		};
	},
};
