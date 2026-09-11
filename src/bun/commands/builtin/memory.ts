import type { CommandDefinition } from "../types";

export const command: CommandDefinition = {
	name: "memory",
	description: "Incrementally organize the partner's long-term memory",
	kind: "execute",
	hint: "[scenes|persona|status|consolidate]",
	async handler({ ctx, signal, rawInput, utils }) {
		const arg = rawInput.trim();
		if (arg === "scenes") {
			const res = await ctx.organizeScenes(signal);
			if (!res.ok) return { kind: "error", text: res.error ?? "scene pass failed" };
			await utils.sendMessage((res.added ?? 0) > 0 ? `updated ${res.added} scene revisions` : "no scene changes");
			return { kind: "success" };
		}
		if (arg === "persona") {
			const res = await ctx.organizePersona(signal);
			if (!res.ok) return { kind: "error", text: res.error ?? "profile pass failed" };
			await utils.sendMessage((res.added ?? 0) > 0 ? "persona updated" : "no persona changes");
			return { kind: "success" };
		}
		if (arg === "status") {
			const res = await ctx.memoryStatus();
			if (!res.ok || !res.text) return { kind: "error", text: res.error ?? "status failed" };
			await utils.sendMessage(res.text);
			return { kind: "success" };
		}
		if (arg === "consolidate") {
			const res = await ctx.consolidateMemory(signal);
			if (!res.ok) return { kind: "error", text: res.error ?? "consolidation failed" };
			await utils.sendMessage((res.added ?? 0) > 0 ? `merged ${res.added} groups` : "nothing to merge");
			return { kind: "success" };
		}
		if (arg !== "") return { kind: "error", text: `unknown /memory argument "${arg}"` };
		const res = await ctx.organizeMemory(signal);
		if (!res.ok) return { kind: "error", text: res.error ?? "memory organize failed" };
		await utils.sendMessage((res.added ?? 0) > 0 ? `organized ${res.added} memories` : "no new memories");
		return { kind: "success" };
	},
};
