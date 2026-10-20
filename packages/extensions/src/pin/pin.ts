import type { Extension } from "@milu/core";

export const pinExtension: Extension = {
	id: "pin",
	apiVersion: 1,

	contributions: {
		"session.menu": [
			{
				id: "pin",
				order: 10,
				group: "state",
				title: async (session) => ((await session.profile())?.pinned ? "Unpin" : "Pin"),
				icon: async (session) => ((await session.profile())?.pinned ? "pin-off" : "pin"),
				action: "pin.toggle",
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "pin.toggle",
			run: async ({ session }) => {
				if (!session) throw new Error("pin.toggle needs a session");
				const profile = await session.profile();
				await session.pin(profile?.pinned !== true);
			},
		});
	},
};
