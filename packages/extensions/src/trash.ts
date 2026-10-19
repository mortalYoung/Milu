import { rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { Extension } from "@milu/core";

async function moveToTrash(path: string): Promise<void> {
	await rename(path, join(homedir(), ".Trash", `${basename(path)}-${Date.now()}`));
}

export const trashExtension: Extension = {
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
				confirm: (session) => ({
					title: `Move "${session.name}" to the Trash?`,
					description: "Its folder moves to the trash, together with any forks of it.",
					confirmLabel: "Move to Trash",
				}),
				action: "trash.session",
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "trash.session",
			run: async ({ session, sessions }) => {
				if (!session) throw new Error("trash.session needs a session");
				const forks = await sessions?.forksOf(session.name);
				for (const name of [session.name, ...(forks ?? [])]) await moveToTrash(sessions?.get(name).root ?? session.root);
			},
		});
	},
};
