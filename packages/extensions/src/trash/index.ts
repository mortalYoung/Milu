import type { Extension } from "@milu/core";

const trashExtension: Extension = {
	id: "trash",
	apiVersion: 1,

	contributions: {
		"session.menu": [
			{
				id: "trash",
				order: 90,
				group: "danger",
				danger: true,
				icon: "trash",
				title: "Move to Trash",
				action: "trash.session",
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "trash.session",
			confirm: ({ session }) => {
				if (!session) throw new Error("trash.session needs a session");
				return {
					title: `Move "${session.name}" to the Trash?`,
					description: "Its folder moves to the trash, together with any forks of it.",
					confirmLabel: "Move to Trash",
					danger: true,
				};
			},
			run: async ({ session, sessions }) => {
				if (!session || !sessions) throw new Error("trash.session needs a session");
				const names = [session.name, ...(await sessions.forksOf(session.name))];
				const busy = names.filter((name) => sessions.running(name));
				if (busy.length > 0) throw new Error(`${busy.map((name) => `"${name}"`).join(", ")} is still running; stop it before deleting`);
				for (const name of names) await sessions.remove(name);
			},
		});
	},
};

export default trashExtension;
