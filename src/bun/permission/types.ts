import { FileError } from "@earendil-works/pi-agent-core";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface PermissionPolicy {
	workspace: string | null;
	storage: string | null;
	trash?: string | null;
	mode: SandboxMode;
}

export interface SandboxNetwork {
	allowedDomains: string[];
	deniedDomains: string[];
	allowLocalBinding: boolean;
	allowUnixSockets: string[];
}

export interface ConfineCall {
	commandId?: string;
}

export interface ConfinedArgv {
	argv: string[];
	enforcement: "full" | "partial" | "none";
	denialSignatures: string[];
	runnerFailureRules: string[];
	env?: NodeJS.ProcessEnv;
}

export interface SandboxBackend {
	readonly id: string;
	readonly platforms: NodeJS.Platform[];
	probe(): boolean;
	confine(argv: string[], policy: PermissionPolicy, call?: ConfineCall): Promise<ConfinedArgv>;
	release?(): Promise<void>;
	annotateStderr?(commandId: string, stderr: string): string;
}

export interface EscalationRequest {
	command: string;
	from: SandboxMode;
	to: SandboxMode;
	justification: string;
	toolCallId: string;
}

export type EscalationDecision = { approved: true; mode: SandboxMode } | { approved: false; reason: string };

export type FileOp = "read" | "write";

export type PermissionCode =
	| "outside_workspace"
	| "sensitive_file"
	| "read_only_write"
	| "sandbox_denied"
	| "sandbox_unavailable"
	| "escalation_not_wider"
	| "escalation_no_justification"
	| "escalation_rejected"
	| "workspace_validation";

/** Structured answer to "may I?" — allowed, or a code + the human-readable reason. */
export type PermissionDecision = { allowed: true } | { allowed: false; code: PermissionCode; reason: string };

/** Escalation verdict: granted mode on approval, or a denial code + reason. */
export type EscalationResult = { allowed: true; mode: SandboxMode } | { allowed: false; code: PermissionCode; reason: string };

/** FileError carrying the permission code — pi's FileError stays untouched (subclass adapter, not a replacement). */
export class PermissionError extends FileError {
	readonly permissionCode: PermissionCode;
	constructor(message: string, path: string, permissionCode: PermissionCode) {
		super("permission_denied", message, path);
		this.permissionCode = permissionCode;
	}
}
