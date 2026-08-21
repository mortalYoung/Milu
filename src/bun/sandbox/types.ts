/**
 * Sandbox adapter contract (see docs/2026-08-20-sandbox-plan.md).
 *
 * The seam is a manager with pluggable backends: consumers never mention a platform —
 * they call `SandboxManager.confine(argv, policy)`. macOS (seatbelt) is the first
 * backend; Linux (bwrap/landlock) and Windows (appcontainer) are fail-closed stubs.
 */
import type { SandboxMode } from "../../shared/rpc";

export type { SandboxMode };

/** The confinement request: mode + the roots a command may write under `workspace-write`. */
export interface SandboxPolicy {
	mode: SandboxMode;
	/** Writable under workspace-write. Null → no workspace grant. */
	workspaceRoot: string | null;
	/** Always writable under workspace-write (agent state). */
	storageRoot: string | null;
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
	confine(argv: string[], policy: SandboxPolicy): ConfinedArgv;
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
