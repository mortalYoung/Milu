export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface PermissionPolicy {
	readonly mode: SandboxMode;
	readonly workspace: string | null;
	readonly storage: string;
	readonly trash: string;
}

export interface ConfinedArgv {
	readonly argv: string[];
	readonly enforcement: "full" | "partial" | "none";
	readonly denialSignatures: string[];
	readonly runnerFailureRules: string[];
}

export interface SandboxBackend {
	readonly id: string;
	probe(): boolean;
	confine(argv: string[], policy: PermissionPolicy): Promise<ConfinedArgv>;
}

export type PermissionCode = "outside_workspace" | "sensitive_file" | "read_only_write";

export type PermissionDecision = { readonly allowed: true } | { readonly allowed: false; readonly code: PermissionCode; readonly reason: string };
