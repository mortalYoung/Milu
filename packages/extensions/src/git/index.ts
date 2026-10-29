import { type Extension, type Session } from "@milu/core";

import { gitChanges, gitFileSides, gitPatch } from "./lib/git.ts";
import type { GitChanges } from "./types.ts";

/** A session with no workspace has no repository: the point drops the item instead of rendering an empty pane. */
const workspaceOnly = async (session: Session): Promise<true | null> => ((await session.workspace()) === null ? null : true);

const rootOf = async (session: Session): Promise<string> => {
	const workspace = await session.workspace();
	if (workspace === null) throw new Error("git needs a workspace");
	return workspace.path;
};

const changeOf = (args: unknown): { path: string; staged: boolean; from?: string } => {
	const value = (args ?? {}) as { path?: unknown; staged?: unknown; from?: unknown };
	if (typeof value.path !== "string" || value.path === "") throw new Error("git needs a file path");
	return { path: value.path, staged: value.staged === true, ...(typeof value.from === "string" && value.from !== "" ? { from: value.from } : {}) };
};

const gitExtension: Extension = {
	id: "git",
	apiVersion: 1,

	widgets: [
		{ id: "git.bar", type: "slot", entry: "./widget/git.tsx", export: "GitButton" },
		{ id: "git.head", type: "slot", entry: "./widget/git.tsx", export: "GitHead" },
		{ id: "git.pane", type: "slot", entry: "./widget/git.tsx", export: "GitPane" },
		{ id: "git.changes", type: "service", entry: "./widget/service.ts" },
	],

	contributions: {
		"chat.bar": [{ id: "git", order: 41, component: "git.bar", data: workspaceOnly }],
		"dock.bar": [{ id: "git", order: 20, component: "git.head", data: workspaceOnly }],
		"dock.views": [{ id: "git", order: 30, component: "git.pane", title: "Changes", icon: "git-branch", data: workspaceOnly }],
	},

	activate(context) {
		context.actions.register({
			id: "git.changes",
			run: async ({ session }) => {
				if (!session) throw new Error("git.changes needs a session");
				const workspace = await session.workspace();
				if (workspace === null) return { data: { repoRoot: null, changes: [] } satisfies GitChanges };
				return { data: (await gitChanges(workspace.path)) satisfies GitChanges };
			},
		});

		context.actions.register({
			id: "git.sides",
			run: async ({ session, args }) => {
				if (!session) throw new Error("git.sides needs a session");
				const change = changeOf(args);
				const root = await rootOf(session);
				return { data: await gitFileSides(root, change.path, { staged: change.staged, ...(change.from === undefined ? {} : { from: change.from }) }) };
			},
		});

		context.actions.register({
			id: "git.patch",
			run: async ({ session, args }) => {
				if (!session) throw new Error("git.patch needs a session");
				const change = changeOf(args);
				return { data: await gitPatch(await rootOf(session), change.path, { staged: change.staged }) };
			},
		});
	},
};

export default gitExtension;
