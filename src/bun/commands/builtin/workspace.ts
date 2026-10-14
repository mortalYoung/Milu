import { expandHome } from "../../lib/home";
import type { CommandDefinition } from "../types";

export const command: CommandDefinition = {
	name: "workspace",
	description: "Set or clear the working directory for this conversation (no path clears)",
	kind: "leadingInput",
	hint: "[<path>]",
	async handler({ ctx, rawInput, utils }) {
		const trimmed = rawInput.trim();
		const target = trimmed ? expandHome(trimmed) : null;
		const res = await ctx.applyWorkspace(target);
		if (!res.ok) return { kind: "error", text: res.error };
		if (res.workspace) await utils.sendMessage(res.workspace);
		return { kind: "success", ...(res.workspace ? { text: res.workspace } : {}) };
	},
};
