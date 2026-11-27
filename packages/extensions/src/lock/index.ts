import type { Extension } from "@milu/core";

const lockExtension: Extension = {
	id: "lock",
	apiVersion: 1,

	contributions: {
		"session.menu": [
			{
				id: "lock",
				order: 12,
				group: "state",
				title: async (session) => ((await session.profile())?.locked ? "Unlock" : "Lock"),
				icon: async (session) => ((await session.profile())?.locked ? "lock-open" : "lock"),
				action: "lock.toggle",
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "lock.toggle",
			run: async ({ session }) => {
				if (!session) throw new Error("lock.toggle needs a session");
				const profile = await session.profile();
				await session.lock(profile?.locked !== true);
			},
		});
	},
};

export default lockExtension;
