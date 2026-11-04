import type { Agent } from "@milu/core";

import type { MemoryRunReason } from "./store.ts";

export type PassOutcome = "advanced" | "stalled" | "done";

export interface RalphLoopOptions {
	readonly maxAttempts: number;
	readonly signal?: AbortSignal;
	createPass: () => { readonly agent: Agent; readonly prompt: string };
	settlePass: () => PassOutcome | Promise<PassOutcome>;
}

export interface RalphLoopResult {
	readonly attempts: number;
	readonly reason: MemoryRunReason;
}

export async function runRalphLoop(opts: RalphLoopOptions): Promise<RalphLoopResult> {
	let attempts = 0;
	let done = false;
	while (opts.signal?.aborted !== true && attempts < opts.maxAttempts) {
		const { agent, prompt } = opts.createPass();
		const onAbort = () => agent.abort();
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		try {
			await agent.prompt(prompt);
			await agent.waitForIdle();
		} finally {
			opts.signal?.removeEventListener("abort", onAbort);
		}
		if (opts.signal?.aborted) break;
		attempts += 1;
		const outcome = await opts.settlePass();
		if (outcome === "done") done = true;
		if (outcome !== "advanced") break;
	}
	return { attempts, reason: opts.signal?.aborted ? "interrupted" : done ? "completed" : "unfinished" };
}
