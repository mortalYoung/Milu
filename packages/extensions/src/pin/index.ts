import type { Extension } from "@milu/core";

const pinExtension: Extension = {
	id: "pin",
	apiVersion: 1,

	contributions: {
		"session.menu": [
			{
				id: "pin",
				order: 10,
				group: "state",
				title: async (session) => {
					const profile = await session.profile();
					if (profile?.forkedFrom !== undefined) return null;
					return profile?.pinned ? "Unpin" : "Pin";
				},
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
				if (profile?.forkedFrom !== undefined) throw new Error("a fork cannot be pinned — pin the chat it came from");
				await session.pin(profile?.pinned !== true);
			},
		});
	},
};

export default pinExtension;
