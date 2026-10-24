import type { AgentMessage, Entry } from "@earendil-works/pi-agent-core";
import { createServiceId, type Disposable, type Service } from "@milu/di";

import { type CompactionPlan, planCompaction } from "../session/compact.ts";
import type { Session } from "../session/session.ts";

export interface CompactionContext {
	readonly session: Session;
	readonly entries: readonly Entry[];
	readonly messages: readonly AgentMessage[];
}

export type CompactionPlanner = (context: CompactionContext) => CompactionPlan | null | Promise<CompactionPlan | null>;

export class CompactionService implements Service {
	private _planner: CompactionPlanner | null = null;

	register(planner: CompactionPlanner): Disposable {
		if (this._planner) throw new Error("a compaction planner is already registered");
		this._planner = planner;
		return {
			dispose: () => {
				if (this._planner === planner) this._planner = null;
			},
		};
	}

	async plan(context: CompactionContext): Promise<CompactionPlan | null> {
		if (this._planner) return this._planner(context);
		return planCompaction(context.entries, context.messages);
	}

	dispose(): void {
		this._planner = null;
	}
}

export const ICompactionService = createServiceId<CompactionService>("CompactionService");
