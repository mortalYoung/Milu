/**
 * SandboxManager — the confinement seam. Registers per-platform backends, probes once,
 * caches the first usable one, and fails closed: no usable backend ⇒ confined calls
 * throw SANDBOX_UNAVAILABLE. `danger-full-access` bypasses the seam entirely.
 */
import { seatbeltBackend } from "./backends/seatbelt";
import type { ConfinedArgv, PermissionPolicy, SandboxBackend } from "./types";

export class SandboxUnavailableError extends Error {
	constructor(message = "SANDBOX_UNAVAILABLE — no usable sandbox backend on this platform") {
		super(message);
		this.name = "SandboxUnavailableError";
	}
}

export interface SandboxManagerOptions {
	/** Backend chain override; defaults to the per-platform chain. */
	backends?: SandboxBackend[];
}

export class SandboxManager {
	private readonly backends: SandboxBackend[];
	private selected: SandboxBackend | null = null;
	private probed = false;

	constructor(options: SandboxManagerOptions = {}) {
		// Per-platform chain. macOS → seatbelt; linux/win32 are future work → fail closed until implemented.
		const platform = process.platform;
		const defaultChain: SandboxBackend[] = platform === "darwin" ? [seatbeltBackend] : [];
		this.backends = options.backends ?? defaultChain;
	}

	/** Probe once (synchronously) and cache the first usable backend. */
	resolveSync(): SandboxBackend | null {
		if (this.probed) return this.selected;
		this.probed = true;
		for (const backend of this.backends) {
			try {
				if (backend.probe()) {
					this.selected = backend;
					break;
				}
			} catch {
				// a probe that throws is an unusable backend
			}
		}
		return this.selected;
	}

	async resolve(): Promise<SandboxBackend | null> {
		return this.resolveSync();
	}

	/** True when a confining backend is mounted — gates whether escalation params appear in tool schemas. */
	isConfining(): boolean {
		return this.resolveSync() !== null;
	}

	/**
	 * Confine argv under a policy. danger-full-access bypasses the seam (original argv,
	 * enforcement "none"). Throws SandboxUnavailableError when no backend is usable.
	 */
	async confine(argv: string[], policy: PermissionPolicy): Promise<ConfinedArgv> {
		if (policy.mode === "danger-full-access") {
			return { argv, enforcement: "none", denialSignatures: [], runnerFailureRules: [] };
		}
		const backend = await this.resolve();
		if (!backend) throw new SandboxUnavailableError();
		return backend.confine(argv, policy);
	}
}
