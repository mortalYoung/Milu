import { rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { Extension } from "@milu/core";

async function moveToTrash(path: string): Promise<void> {
	await rename(path, join(homedir(), ".Trash", `${basename(path)}-${Date.now()}`));
}

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
				const roots = names.map((name) => sessions.get(name).root);
				for (const name of names) await sessions.close(name);
				for (const root of roots) await moveToTrash(root);
			},
		});
	},
};

export default trashExtension;
