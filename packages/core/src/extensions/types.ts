import type { DisposableStore } from "@milu/di";

import type { AgentLoopService } from "../services/agent-loop.ts";
import type { ConfigService } from "../services/config.ts";
import type { ContributionService } from "../services/contributions.ts";
import type { SessionService } from "../services/sessions.ts";

export interface ExtensionContext {
	readonly id: string;
	readonly disposables: DisposableStore;
	readonly contributions: ContributionService;
	readonly loop: AgentLoopService;
	readonly sessions: SessionService;
	readonly config: ConfigService;
}

export interface Extension {
	readonly id: string;
	activate(context: ExtensionContext): void | Promise<void>;
}
