import type { CommandDefinition } from "../types";

export const command: CommandDefinition = {
	name: "compact",
	description: "Manually compact the conversation surface",
	kind: "execute",
	async handler({ ctx, signal }) {
		const result = await ctx.runManualCompact(signal);
		if (!result.ok) return { kind: "error", text: result.error ?? "compact failed" };
		return { kind: "success" };
	},
};
