import type { Agent, AgentMessage } from "@milu/core";

import type { MemoryRunReason } from "./store.ts";

export type PassOutcome = "advanced" | "stalled" | "done";

export interface RalphLoopOptions {
	readonly maxAttempts: number;
	readonly signal?: AbortSignal;
	createPass: () => { readonly agent: Agent; readonly prompt: string };
	onProgress?: (passes: readonly (readonly AgentMessage[])[]) => void;
	settlePass: () => PassOutcome | Promise<PassOutcome>;
}

export interface RalphLoopResult {
	readonly attempts: number;
	readonly reason: MemoryRunReason;
	readonly passes: readonly (readonly AgentMessage[])[];
}

export async function runRalphLoop(opts: RalphLoopOptions): Promise<RalphLoopResult> {
	let attempts = 0;
	let done = false;
	const passes: (readonly AgentMessage[])[] = [];
	while (opts.signal?.aborted !== true && attempts < opts.maxAttempts) {
		const { agent, prompt } = opts.createPass();
		const stop = opts.onProgress
			? agent.subscribe((event) => {
					if (event.type === "message_end") opts.onProgress?.([...passes, agent.state.messages]);
				})
			: undefined;
		const onAbort = () => agent.abort();
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		try {
			await agent.prompt(prompt);
			await agent.waitForIdle();
		} finally {
			stop?.();
			opts.signal?.removeEventListener("abort", onAbort);
		}
		passes.push([...agent.state.messages]);
		if (opts.signal?.aborted) break;
		attempts += 1;
		const outcome = await opts.settlePass();
		if (outcome === "done") done = true;
		if (outcome !== "advanced") break;
	}
	return { attempts, passes, reason: opts.signal?.aborted ? "interrupted" : done ? "completed" : "unfinished" };
}
