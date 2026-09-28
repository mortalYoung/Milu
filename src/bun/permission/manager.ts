import { seatbeltBackend } from "./backends/seatbelt";
import type { ConfinedArgv, PermissionPolicy, SandboxBackend } from "./types";

export class SandboxUnavailableError extends Error {
	constructor(message = "SANDBOX_UNAVAILABLE — no usable sandbox backend on this platform") {
		super(message);
		this.name = "SandboxUnavailableError";
	}
}

export interface SandboxManagerOptions {
	backends?: SandboxBackend[];
}

export class SandboxManager {
	private readonly backends: SandboxBackend[];
	private selected: SandboxBackend | null = null;
	private probed = false;

	constructor(options: SandboxManagerOptions = {}) {
		const platform = process.platform;
		const defaultChain: SandboxBackend[] = platform === "darwin" ? [seatbeltBackend] : [];
		this.backends = options.backends ?? defaultChain;
	}

	resolveSync(): SandboxBackend | null {
		if (this.probed) return this.selected;
		this.probed = true;
		for (const backend of this.backends) {
			try {
				if (backend.probe()) {
					this.selected = backend;
					break;
				}
			} catch {}
		}
		return this.selected;
	}

	async resolve(): Promise<SandboxBackend | null> {
		return this.resolveSync();
	}

	isConfining(): boolean {
		return this.resolveSync() !== null;
	}

	async confine(argv: string[], policy: PermissionPolicy): Promise<ConfinedArgv> {
		if (policy.mode === "danger-full-access") {
			return { argv, enforcement: "none", denialSignatures: [], runnerFailureRules: [] };
		}
		const backend = await this.resolve();
		if (!backend) throw new SandboxUnavailableError();
		return backend.confine(argv, policy);
	}
}
