import type { CommandDefinition } from "../types";

export const command: CommandDefinition = {
	name: "memory",
	description: "Incrementally organize the partner's long-term memory",
	kind: "execute",
	async handler({ ctx, signal }) {
		const res = await ctx.organizeMemory(signal);
		if (!res.ok) return { kind: "error", text: res.error ?? "memory organize failed" };
		return { kind: "success", text: (res.added ?? 0) > 0 ? `organized ${res.added} memories` : "no new memories" };
	},
};
