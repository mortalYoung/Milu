import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

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

async function moveToTrash(path: string): Promise<void> {
	await rename(path, join(homedir(), ".Trash", `${basename(path)}-${Date.now()}`));
}

async function openPath(path: string, args: unknown): Promise<void> {
	const target = (args ?? {}) as { editorId?: string; via?: string };
	const opened = target.via === "finder" ? await openInFinder(path) : await openInCodeEditor(path, target.editorId);
	if (!opened.ok) throw new Error(`could not open ${path}`);
}

export const actionsExtension: Extension = {
	id: "actions",
	apiVersion: 1,

	contributions: {
		"session.header": [{ id: "create", title: "Create", icon: "square-pen", action: "create.session" }],
		"session.menu": [
			{
				id: "pin",
				order: 10,
				group: "state",
				title: async (session) => ((await session.profile())?.pinned ? "Unpin" : "Pin"),
				icon: async (session) => ((await session.profile())?.pinned ? "pin-off" : "pin"),
				action: "pin.toggle",
			},
			{
				id: "copy-path",
				order: 20,
				group: "copy",
				title: "Copy directory path",
				icon: "copy",
				action: "copy.path",
			},
			{
				id: "copy-workspace",
				order: 21,
				group: "copy",
				title: async (session) => ((await session.workspace()) ? "Copy workspace path" : null),
				icon: "copy",
				action: "copy.workspace",
			},
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
			id: "create.session",
			run: async ({ sessions, dialog }) => {
				const values = (await dialog?.({ kind: "custom", id: "create-session" })) as { name?: string; persona?: string; workspace?: string } | null;
				if (!values?.name) return undefined;

				const name = values.name.trim();
				const root = sessions?.partnerRoot;
				if (!root) throw new Error("no partner root");
				if ((await sessions?.names())?.some((each) => each.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" already exists`);

				const dir = join(root, name);
				await mkdir(dir, { recursive: true });
				const profile = { name, createdAt: Date.now(), ...(values.persona ? { persona: values.persona } : {}) };
				await writeFile(join(dir, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
				if (values.workspace) await writeFile(join(dir, "workspace.json"), `${JSON.stringify({ path: values.workspace, kind: null, repo: null }, null, 2)}\n`, "utf8");
				return { kind: "select", session: name };
			},
		});

		context.actions.register({
			id: "pin.toggle",
			run: async ({ session }) => {
				if (!session) throw new Error("pin.toggle needs a session");
				const profile = await session.profile();
				await session.pin(profile?.pinned !== true);
			},
		});

		context.actions.register({
			id: "copy.path",
			run: ({ session }) => {
				if (!session) throw new Error("copy.path needs a session");
				return { kind: "copy", text: session.path };
			},
		});

		context.actions.register({
			id: "copy.workspace",
			run: async ({ session }) => {
				const workspace = await session?.workspace();
				return workspace ? { kind: "copy", text: workspace.path } : undefined;
			},
		});

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

		context.actions.register({
			id: "trash.session",
			run: async ({ session, sessions, confirm }) => {
				if (!session) throw new Error("trash.session needs a session");
				const agreed = await confirm?.({
					title: `Move "${session.name}" to the Trash?`,
					description: "Its folder moves to the trash, together with any forks of it.",
					confirmLabel: "Move to Trash",
					danger: true,
				});
				if (!agreed) return;
				const forks = (await sessions?.forksOf(session.name)) ?? [];
				for (const name of [session.name, ...forks]) await moveToTrash(sessions?.get(name).root ?? session.root);
			},
		});
	},
};
