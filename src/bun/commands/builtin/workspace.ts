import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandDefinition } from "../types";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

export const command: CommandDefinition = {
	name: "workspace",
	description: "Set the working directory for this conversation",
	kind: "leadingInput",
	hint: "[<path>]",
	async handler({ ctx, rawInput, utils }) {
		const path = expandHome(rawInput.trim());
		if (!path) return { kind: "error", text: "usage: /workspace <path>" };
		const decision = ctx.agent.permission.setWorkspace(path);
		if (!decision.allowed) return { kind: "error", text: decision.reason };
		ctx.agent.setWorkspace(decision.resolved);
		await ctx.persistWorkspace(decision.resolved);
		await utils.sendMessage(decision.resolved);
		return { kind: "success" };
	},
};
