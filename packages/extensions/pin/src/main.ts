import type { Extension } from "@milu/core";

/** The pinned flag belongs to the session (v1 writes it into `profile.json`); the command lives here. */
export const pinExtension: Extension = {
	id: "pin",
	apiVersion: 1,

	contributions: {
		"session.menu": [
			{
				id: "pin",
				order: 10,
				action: "pin.toggle",
				title: async (session) => ((await session.profile())?.pinned ? "Unpin" : "Pin"),
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
