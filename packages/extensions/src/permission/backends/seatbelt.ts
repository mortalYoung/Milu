import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { gitRoots, writableRoots } from "../roots.ts";
import type { ConfinedArgv, PermissionPolicy, SandboxBackend } from "../types.ts";

const SEATBELT = "/usr/bin/sandbox-exec";

const DENIAL_SIGNATURES = ["operation not permitted"];
const RUNNER_FAILURE_RULES = ["sandbox-exec: "];

const PROBE_PROFILE = ["-p", '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null"))'];

function escape(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function seatbeltProfileArgs(policy: PermissionPolicy): string[] {
	const forms = ["(version 1)", "(allow default)", "(deny file-write*)", '(allow file-write* (literal "/dev/null"))'];
	const roots = writableRoots(policy);
	if (roots.length > 0) forms.push(`(allow file-write* ${roots.map((root) => `(subpath "${escape(root)}")`).join(" ")})`);
	const hooks = gitRoots(policy.workspace)
		.map((root) => `(subpath "${escape(join(root, "hooks"))}")`)
		.join(" ");
	if (hooks !== "") forms.push(`(deny file-write* ${hooks})`);
	return ["-p", forms.join(" ")];
}

export const seatbeltBackend: SandboxBackend = {
	id: "seatbelt",

	probe(): boolean {
		if (process.platform !== "darwin") return false;
		try {
			return spawnSync(SEATBELT, [...PROBE_PROFILE, "--", "true"], { stdio: "ignore" }).status === 0;
		} catch {
			return false;
		}
	},

	async confine(argv: string[], policy: PermissionPolicy): Promise<ConfinedArgv> {
		return {
			argv: [SEATBELT, ...seatbeltProfileArgs(policy), "--", ...argv],
			enforcement: "full",
			denialSignatures: DENIAL_SIGNATURES,
			runnerFailureRules: RUNNER_FAILURE_RULES,
		};
	},
};
