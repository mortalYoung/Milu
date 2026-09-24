import { join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { loadSettings, sandboxNetworkFrom } from "../../lib/settings";
import { gitRoots, writableRoots } from "../roots";
import type { ConfineCall, ConfinedArgv, PermissionPolicy, SandboxBackend, SandboxNetwork } from "../types";

const DENIAL_SIGNATURES = ["operation not permitted"];
const RUNNER_FAILURE_RULES = ["sandbox-exec: "];

let sessionNetwork: string | null = null;

const sessionFilesystem = { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], allowGitConfig: true };

function wrapFilesystem(policy: PermissionPolicy) {
	return {
		denyRead: [],
		allowRead: [],
		allowWrite: writableRoots(policy),
		denyWrite: gitRoots(policy.workspace).map((root) => join(root, "hooks")),
	};
}

function sessionConfig(network: SandboxNetwork) {
	return {
		filesystem: { ...sessionFilesystem },
		network: {
			allowedDomains: [...network.allowedDomains],
			deniedDomains: [...network.deniedDomains],
			allowLocalBinding: network.allowLocalBinding,
			allowUnixSockets: [...network.allowUnixSockets],
		},
	};
}

async function ensureNetwork(network: SandboxNetwork): Promise<void> {
	const key = JSON.stringify(network);
	if (sessionNetwork === key) return;
	const config = sessionConfig(network);
	if (sessionNetwork === null) await SandboxManager.initialize(config);
	else SandboxManager.updateConfig(config);
	sessionNetwork = key;
}

export const srtBackend: SandboxBackend = {
	id: "srt",
	platforms: ["darwin", "linux"],
	probe(): boolean {
		if (!srtBackend.platforms.includes(process.platform)) return false;
		try {
			return SandboxManager.isSupportedPlatform() && SandboxManager.checkDependencies().errors.length === 0;
		} catch {
			return false;
		}
	},
	async confine(argv: string[], policy: PermissionPolicy, call?: ConfineCall): Promise<ConfinedArgv> {
		const [shell, flag, command] = argv;
		if (argv.length !== 3 || flag !== "-c" || command === undefined) throw new Error("the srt backend expects a shell command argv");
		await ensureNetwork(sandboxNetworkFrom(await loadSettings()));
		const { argv: wrapped, env } = await SandboxManager.wrapWithSandboxArgv(command, shell, { filesystem: wrapFilesystem(policy) }, undefined, undefined, {
			...(call?.commandId ? { commandId: call.commandId } : {}),
		});
		return { argv: wrapped, enforcement: "full", denialSignatures: DENIAL_SIGNATURES, runnerFailureRules: RUNNER_FAILURE_RULES, env };
	},
	async release(): Promise<void> {
		if (sessionNetwork === null) return;
		sessionNetwork = null;
		await SandboxManager.reset();
	},
	annotateStderr(commandId: string, stderr: string): string {
		return SandboxManager.annotateStderrWithSandboxFailures(commandId, stderr);
	},
};
