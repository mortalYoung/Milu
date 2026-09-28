import { FileError } from "@earendil-works/pi-agent-core";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface PermissionPolicy {
	workspace: string | null;
	storage: string | null;
	trash?: string | null;
	mode: SandboxMode;
}

export interface ConfinedArgv {
	argv: string[];
	enforcement: "full" | "partial" | "none";
	denialSignatures: string[];
	runnerFailureRules: string[];
}

export interface SandboxBackend {
	readonly id: string;
	readonly platforms: NodeJS.Platform[];
	probe(): boolean;
	confine(argv: string[], policy: PermissionPolicy): Promise<ConfinedArgv>;
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

export type PermissionDecision = { allowed: true } | { allowed: false; code: PermissionCode; reason: string };

export type EscalationResult = { allowed: true; mode: SandboxMode } | { allowed: false; code: PermissionCode; reason: string };

export class PermissionError extends FileError {
	readonly permissionCode: PermissionCode;
	constructor(message: string, path: string, permissionCode: PermissionCode) {
		super("permission_denied", message, path);
		this.permissionCode = permissionCode;
	}
}
