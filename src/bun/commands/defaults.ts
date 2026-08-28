import type { CommandDefinition } from "./types";

export function defaultCommands(): CommandDefinition[] {
	return [
		{
			name: "compact",
			description: "Manually compact the conversation surface",
			kind: "execute",
			async handler({ ctx }) {
				const result = await ctx.runManualCompact();
				if (!result.ok) return { kind: "error", text: result.error ?? "compact failed" };
				return { kind: "success", text: result.compacted ? `compacted ${result.compacted} nodes` : "nothing to compact" };
			},
		},
		{
			name: "clear",
			description: "Clear the agent's context",
			kind: "execute",
			async handler({ ctx }) {
				ctx.agent.reset();
				return { kind: "success", text: "context cleared" };
			},
		},
		{
			name: "workspace",
			description: "Set the working directory for this conversation",
			kind: "leadingInput",
			hint: "[<path>]",
			async handler({ ctx, rawInput }) {
				const path = rawInput.trim();
				if (!path) return { kind: "error", text: "usage: /workspace <path>" };
				const decision = ctx.agent.permission.setWorkspace(path);
				if (!decision.allowed) return { kind: "error", text: decision.reason };
				ctx.agent.setWorkspace(decision.resolved);
				await ctx.persistWorkspace(decision.resolved);
				return { kind: "success", text: decision.resolved };
			},
		},
	];
}
