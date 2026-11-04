import { resolve } from "node:path";

import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import { createServiceId, type Service } from "@milu/di";

import { LocalExecutionEnv } from "../execution/local-env.ts";

export class ExecutionService implements Service {
	private readonly _envs = new Map<string, LocalExecutionEnv>();

	env(root: string): ExecutionEnv {
		const key = resolve(root);
		const existing = this._envs.get(key);
		if (existing) return existing;
		const created = new LocalExecutionEnv({ root: key });
		this._envs.set(key, created);
		return created;
	}

	dispose(): void {
		const envs = [...this._envs.values()];
		this._envs.clear();
		for (const env of envs) void env.cleanup();
	}
}

export const IExecutionService = createServiceId<ExecutionService>("ExecutionService");
