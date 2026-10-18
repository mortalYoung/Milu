import { createServiceId, DisposableStore, type Service } from "@milu/di";

import type { Extension, ExtensionContext } from "../extensions/types.ts";
import type { AgentLoopService } from "./agent-loop.ts";
import type { ConfigService } from "./config.ts";
import type { ContributionService } from "./contributions.ts";
import type { SessionService } from "./sessions.ts";

export interface ExtensionDeps {
	extensions: readonly Extension[];
}

interface Loaded {
	readonly extension: Extension;
	readonly disposables: DisposableStore;
}

export class ExtensionService implements Service {
	private readonly _pending: readonly Extension[];
	private readonly _loaded: Loaded[] = [];

	constructor(
		private readonly _agentLoopService: AgentLoopService,
		private readonly _contributionService: ContributionService,
		private readonly _sessionService: SessionService,
		private readonly _configService: ConfigService,
		deps: ExtensionDeps,
	) {
		this._pending = deps.extensions;
	}

	async initialize(): Promise<void> {
		for (const extension of this._pending) await this.load(extension);
	}

	async load(extension: Extension): Promise<void> {
		if (this._loaded.some((entry) => entry.extension.id === extension.id)) {
			throw new Error(`extension "${extension.id}" is already loaded`);
		}

		const disposables = new DisposableStore();
		const context: ExtensionContext = {
			id: extension.id,
			disposables,
			contributions: this._contributionService,
			loop: this._agentLoopService,
			sessions: this._sessionService,
			config: this._configService,
		};

		this._loaded.push({ extension, disposables });
		try {
			await extension.activate(context);
		} catch (error) {
			this.unload(extension.id);
			throw new Error(`extension "${extension.id}" failed to activate: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	unload(id: string): void {
		const at = this._loaded.findIndex((entry) => entry.extension.id === id);
		if (at < 0) return;
		const [entry] = this._loaded.splice(at, 1);
		entry?.disposables.dispose();
	}

	loaded(): readonly string[] {
		return this._loaded.map((entry) => entry.extension.id);
	}

	dispose(): void {
		const failures: unknown[] = [];
		for (const entry of this._loaded.splice(0).reverse()) {
			try {
				entry.disposables.dispose();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "extension dispose failed");
	}
}

export const ExtensionServiceId = createServiceId<ExtensionService>("ExtensionService");
