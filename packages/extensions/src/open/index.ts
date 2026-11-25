import type { Extension, SessionMenuItem } from "@milu/core";

import { editorIcon, finderIcon, listInstalledEditors, openInCodeEditor, openInFinder } from "./openers.ts";

async function openTargets(action: string): Promise<SessionMenuItem[]> {
	const editors = await Promise.all(
		listInstalledEditors().map(async (editor) => ({
			id: `${action}:${editor.id}`,
			title: editor.name,
			icon: (await editorIcon(editor)) ?? editor.icon,
			action,
			args: { editorId: editor.id },
		})),
	);
	return [...editors, { id: `${action}:finder`, title: "Finder", icon: (await finderIcon()) ?? "finder", action, args: { via: "finder" } }];
}

async function openPath(path: string, args: unknown): Promise<void> {
	const target = (args ?? {}) as { editorId?: string; via?: string };
	const opened = target.via === "finder" ? await openInFinder(path) : await openInCodeEditor(path, target.editorId);
	if (!opened.ok) throw new Error(`could not open ${path}`);
}

const openExtension: Extension = {
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
				items: () => openTargets("open.storage"),
			},
		],
	},

	activate(context) {
		for (const editor of listInstalledEditors()) void editorIcon(editor);
		void finderIcon();

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

export default openExtension;
