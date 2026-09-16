/**
 * Permission module types — the single source of truth for every permission
 * concept: sandbox modes, policy, decisions, escalation, and error codes.
 * `src/shared/rpc.ts` re-exports the transport-facing types from here.
 */
import { FileError } from "@earendil-works/pi-agent-core";

/** File-effect sandbox mode (per partner; human-owned via the composer select). */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** The effective permission policy for one agent run: where it may write, under which mode. */
export interface PermissionPolicy {
	/** Writable under workspace-write; null → no workspace grant. */
	workspace: string | null;
	/** Always writable under workspace-write (agent state). */
	storage: string | null;
	trash?: string | null;
	/** The session's effective confinement mode. */
	mode: SandboxMode;
}

/** Facts every wrap carries so consumers don't guess. */
export interface ConfinedArgv {
	argv: string[];
	/** "full" = kernel enforces every promised file effect; "partial" = weaker (old Landlock); "none" = unconfined bypass. */
	enforcement: "full" | "partial" | "none";
	/** stderr substrings the kernel prints on a denied file effect. */
	denialSignatures: string[];
	/** stderr evidence the runner itself failed before exec (the command never ran). */
	runnerFailureRules: string[];
}

/** One platform backend. `probe()` false ⇒ unavailable ⇒ fail closed. */
export interface SandboxBackend {
	readonly id: string;
	readonly platforms: NodeJS.Platform[];
	probe(): boolean;
	confine(argv: string[], policy: PermissionPolicy): ConfinedArgv;
}

/** A requested escalation (model asks for a strictly wider mode on one retry). */
export interface EscalationRequest {
	command: string;
	from: SandboxMode;
	to: SandboxMode;
	justification: string;
	/** The pi tool-call id of the blocked bash call — persisted with the request so a restart can
	 * locate the dangling assistant turn in the log and resume from the tool result. */
	toolCallId: string;
}

export type EscalationDecision = { approved: true; mode: SandboxMode } | { approved: false; reason: string };

/** A file-effect operation the fence judges. */
export type FileOp = "read" | "write";

/** The stable denial vocabulary — every refusal carries one code. */
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
