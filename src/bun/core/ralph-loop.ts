import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";

export type PassOutcome = "advanced" | "stalled" | "done";

export interface RalphLoopPass {
	agent: Agent;
	prompt: string;
}

export interface RalphLoopOptions {
	maxAttempts: number;
	signal?: AbortSignal;
	createPass: (pass: number) => RalphLoopPass;
	settlePass: (pass: number) => PassOutcome | Promise<PassOutcome>;
	onPass?: (pass: number, messages: AgentMessage[]) => void;
}

export interface RalphLoopResult {
	attempts: number;
	reason: "completed" | "unfinished" | "interrupted";
}

export async function runRalphLoop(opts: RalphLoopOptions): Promise<RalphLoopResult> {
	let attempts = 0;
	let done = false;
	while (opts.signal?.aborted !== true && attempts < opts.maxAttempts) {
		const { agent, prompt } = opts.createPass(attempts + 1);
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
		opts.onPass?.(attempts, agent.state.messages);
		const outcome = await opts.settlePass(attempts);
		if (outcome === "done") done = true;
		if (outcome !== "advanced") break;
	}
	return { attempts, reason: opts.signal?.aborted ? "interrupted" : done ? "completed" : "unfinished" };
}
