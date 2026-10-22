import type { Extension, SessionMenuItem } from "@milu/core";

import { listInstalledEditors, openInCodeEditor, openInFinder } from "./openers.ts";

function openTargets(action: string): SessionMenuItem[] {
	return [
		{ id: `${action}:default`, title: "Open with default", action, args: {} },
		{ id: `${action}:finder`, title: "Open with Finder", action, args: { via: "finder" } },
		...listInstalledEditors().map((editor) => ({
			id: `${action}:${editor.id}`,
			title: `Open with ${editor.name}`,
			action,
			args: { editorId: editor.id },
		})),
	];
}

async function openPath(path: string, args: unknown): Promise<void> {
	const target = (args ?? {}) as { editorId?: string; via?: string };
	const opened = target.via === "finder" ? await openInFinder(path) : await openInCodeEditor(path, target.editorId);
	if (!opened.ok) throw new Error(`could not open ${path}`);
}

export const openExtension: Extension = {
	id: "open",
	apiVersion: 1,

	contributions: {
		"session.menu": [
			{
				id: "open-workspace",
				order: 30,
				group: "open",
				icon: "folder",
				title: async (session) => ((await session.workspace()) ? "Open workspace" : null),
				items: async (session) => ((await session.workspace()) ? openTargets("open.workspace") : []),
			},
			{
				id: "open-storage",
				order: 31,
				group: "open",
				icon: "folder",
				title: "Open storage",
				items: openTargets("open.storage"),
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "open.workspace",
			run: async ({ session, args }) => {
				const workspace = await session?.workspace();
				if (!workspace) throw new Error("this session has no workspace");
				await openPath(workspace.path, args);
			},
		});

		context.actions.register({
			id: "open.storage",
			run: async ({ session, args }) => {
				if (!session) throw new Error("open.storage needs a session");
				await openPath(session.storage, args);
			},
		});
	},
};
