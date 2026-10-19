import type { DisposableStore } from "@milu/di";

import type { ConfigService } from "../services/config.ts";
import type { ContributionService } from "../services/contributions.ts";

/** What an extension is given: somewhere to contribute, and the settings to read. */
export interface ExtensionContext {
	readonly id: string;
	readonly disposables: DisposableStore;
	readonly contributions: ContributionService;
	readonly config: ConfigService;
}

export interface Extension {
	readonly id: string;
	activate(context: ExtensionContext): void | Promise<void>;
}
