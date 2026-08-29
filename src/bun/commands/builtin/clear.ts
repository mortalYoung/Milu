import type { CommandDefinition } from "../types";

export const command: CommandDefinition = {
	name: "clear",
	description: "Clear the agent's context",
	kind: "execute",
	async handler({ ctx }) {
		ctx.agent.reset();
		return { kind: "success" };
	},
};
