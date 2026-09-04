import type { CommandDefinition } from "../types";

export const command: CommandDefinition = {
	name: "clear",
	description: "Clear the conversation and start a fresh session (previous log is archived)",
	kind: "execute",
	async handler({ ctx, signal }) {
		const res = await ctx.resetSession(signal);
		if (!res.ok) return { kind: "error", text: res.error ?? "clear failed" };
		return { kind: "success" };
	},
};
