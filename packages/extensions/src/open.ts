import type { SessionMenuItem } from "@milu/core";
import type { Extension } from "@milu/core";

import { listInstalledEditors, openInCodeEditor, openInFinder } from "./openers.ts";

function targets(action: string): SessionMenuItem[] {
	const editors = listInstalledEditors().map((editor) => ({
		id: `${action}:${editor.id}`,
		title: `Open with ${editor.name}`,
		action,
		args: { editorId: editor.id },
	}));
	return [
		{ id: `${action}:default`, title: "Open with default", action, args: {} },
		{ id: `${action}:finder`, title: "Open with Finder", action, args: { via: "finder" } },
		...editors,
	];
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
				items: async (session) => ((await session.workspace()) ? targets("open.workspace") : []),
			},
			{
				id: "open-storage",
				order: 31,
				group: "open",
				icon: "folder",
				title: "Open storage",
				items: targets("open.storage"),
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "open.workspace",
			run: async ({ session, args }) => {
				const workspace = await session?.workspace();
				if (!workspace) throw new Error("this session has no workspace");
				await open(workspace.path, args);
			},
		});
		context.actions.register({
			id: "open.storage",
			run: async ({ session, args }) => {
				if (!session) throw new Error("open.storage needs a session");
				await open(session.storage, args);
			},
		});
	},
};

async function open(path: string, args: unknown): Promise<void> {
	const target = (args ?? {}) as { editorId?: string; via?: string };
	const opened = target.via === "finder" ? await openInFinder(path) : await openInCodeEditor(path, target.editorId);
	if (!opened.ok) throw new Error(`could not open ${path}`);
}
