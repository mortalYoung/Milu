/**
 * The Permission facade — the single public API for every permission decision:
 * the fs fence, the bash sensitive scan, the OS confinement seam, escalation
 * rules, and the workspace policy-change resolution. Consumers never touch
 * the guards or backends directly (see docs/2026-08-25-permission-module.md).
 */
import { resolve } from "node:path";
import { escalate } from "./escalate";
import { checkPath, commandMentionsSensitive, deny } from "./guard";
import { SandboxManager, SandboxUnavailableError } from "./manager";
import type { ConfinedArgv, EscalationDecision, EscalationRequest, EscalationResult, PermissionDecision, PermissionPolicy, SandboxMode } from "./types";
import { validateWorkspace } from "./workspace";

export interface PermissionOptions {
	/** OS confinement seam; absent ⇒ confined calls run unconfined (enforcement "none"). */
	sandbox?: SandboxManager;
	/** The effective policy — resolved per call so workspace/mode changes apply immediately. */
	getPolicy: () => PermissionPolicy;
	/** Human approval gate for escalation retries (RPC orchestration; absent ⇒ escalation unavailable). */
	confirmEscalation?: (request: EscalationRequest) => Promise<EscalationDecision>;
}

export class Permission {
	private readonly sandbox?: SandboxManager;
	private readonly policy: () => PermissionPolicy;
	private readonly confirmEscalation?: (request: EscalationRequest) => Promise<EscalationDecision>;

	constructor(options: PermissionOptions) {
		this.sandbox = options.sandbox;
		this.policy = options.getPolicy;
		this.confirmEscalation = options.confirmEscalation;
	}

	getMode(): SandboxMode {
		return this.policy().mode;
	}

	/** The policy's writable roots — the env's path base for relative resolution. */
	workspaceRoot(): string | null {
		return this.policy().workspace;
	}

	storageRoot(): string | null {
		return this.policy().storage;
	}

	/** True when a confining backend is mounted — gates whether escalation params appear in tool schemas. */
	isConfining(): boolean {
		return this.sandbox?.isConfining() ?? false;
	}

	/** The fs fence: judge a file operation against the policy (target must be absolute). */
	checkFile(target: string, op: "read" | "write"): PermissionDecision {
		return checkPath(target, op, this.policy(), this.sandbox != null);
	}

	/** Best-effort sensitive-file scan for a shell command. */
	checkCommand(command: string): PermissionDecision {
		return commandMentionsSensitive(command) ? deny("sensitive_file", "Sensitive file access is not allowed (except inside the storage path)") : { allowed: true };
	}

	/** Confine argv under the policy, or a per-call escalation mode (danger-full-access bypasses the seam). */
	async confine(argv: string[], options?: { sandboxMode?: SandboxMode }): Promise<ConfinedArgv> {
		if (!this.sandbox) return { argv, enforcement: "none", denialSignatures: [], runnerFailureRules: [] };
		const mode = options?.sandboxMode ?? this.getMode();
		return this.sandbox.confine(argv, { ...this.policy(), mode });
	}

	/** Escalation: capability gate → strictly-wider → justification → the human gate. */
	escalate(request: { command: string; to: SandboxMode; justification: string; toolCallId: string }): Promise<EscalationResult> {
		return escalate(request, {
			getMode: () => this.getMode(),
			isConfining: () => this.isConfining(),
			confirmEscalation: this.confirmEscalation,
		});
	}

	setWorkspace(path: string): { allowed: true; resolved: string } | { allowed: false; code: "workspace_validation"; reason: string } {
		const error = validateWorkspace(path, { storagePath: this.policy().storage });
		if (error) return { allowed: false, code: "workspace_validation", reason: error };
		return { allowed: true, resolved: resolve(path) };
	}
}

export { ESCALATION_UNAVAILABLE_TEXT, escalate } from "./escalate";
export { ALLOWED, checkPath, commandMentionsSensitive, deny, isSensitiveName, sandboxDenialMarker } from "./guard";
export { isSandboxMode, isStrictlyWider, SANDBOX_MODES, widerModes } from "./modes";
export { policyFor } from "./policy";
export { canonicalPath, isInside, writableRoots } from "./roots";
export type {
	ConfinedArgv,
	EscalationDecision,
	EscalationRequest,
	EscalationResult,
	FileOp,
	PermissionCode,
	PermissionDecision,
	PermissionPolicy,
	SandboxBackend,
	SandboxMode,
} from "./types";
export { PermissionError } from "./types";
export { sandboxFilePath, validateWorkspace, workspaceFilePath } from "./workspace";
export { SandboxManager, SandboxUnavailableError };
