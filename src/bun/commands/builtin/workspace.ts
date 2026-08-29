import type { CommandDefinition } from "../types";

export const command: CommandDefinition = {
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
		return { kind: "success" };
	},
};
