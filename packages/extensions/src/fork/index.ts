import type { Extension, Session } from "@milu/core";

const forked = async (session: Session): Promise<boolean> => (await session.profile())?.forkedFrom !== undefined;

const forkExtension: Extension = {
	id: "fork",
	apiVersion: 1,

	contributions: {
		"session.menu": [
			{
				id: "fork.chat",
				order: 40,
				group: "copy",
				icon: "git-fork",
				title: async (session) => ((await forked(session)) ? null : "Fork"),
				disabled: async (session) => session.running || (await session.forking()),
				action: "fork.chat",
			},
			{
				id: "fork.duplicate",
				order: 41,
				group: "copy",
				icon: "copy-plus",
				title: "Duplicate",
				disabled: async (session) => session.running || (await session.forking()),
				action: "fork.duplicate",
			},
			{
				id: "fork.promote",
				order: 42,
				group: "state",
				icon: "arrow-up-from-line",
				title: async (session) => ((await forked(session)) ? "Promote" : null),
				disabled: async (session) => session.running || (await session.forking()),
				action: "fork.promote",
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "fork.chat",
			run: async ({ session, sessions }) => {
				if (!session || !sessions) throw new Error("fork.chat needs a session");
				await sessions.copy(session.name, "fork");
			},
		});

		context.actions.register({
			id: "fork.duplicate",
			run: async ({ session, sessions }) => {
				if (!session || !sessions) throw new Error("fork.duplicate needs a session");
				await sessions.copy(session.name, "duplicate");
			},
		});

		context.actions.register({
			id: "fork.promote",
			run: async ({ session, sessions }) => {
				if (!session || !sessions) throw new Error("fork.promote needs a session");
				await sessions.promote(session.name);
			},
		});
	},
};

export default forkExtension;
