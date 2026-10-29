import { join } from "node:path";

import { type Extension, expandHome } from "@milu/core";

import { openFileInEditor } from "../open/openers.ts";
import { searchFiles } from "./search.ts";

export const DEFAULT_PALETTE_IGNORE_DIRS = [".git", ".DS_Store", "node_modules", "dist", "build", ".next", "out", "target", ".cache", "__pycache__", ".venv", "venv"];

export interface OpenFileArgs {
	readonly path?: string;
	readonly line?: number;
}

const paletteExtension: Extension = {
	id: "palette",
	apiVersion: 1,
	widgets: [{ id: "palette", type: "dialog", entry: "./widget/palette.tsx" }],

	activate(context) {
		const ignore = context.disposables.add(context.settings.declare({ key: "palette", defaults: { searchIgnoreDirs: DEFAULT_PALETTE_IGNORE_DIRS } }));

		context.actions.register({
			id: "palette.open",
			scope: "app",
			hotkey: "Mod+P",
			run: async ({ dialog }) => {
				await dialog?.({ kind: "custom", id: "palette", title: "Command Palette", presentation: "palette" });
			},
		});

		context.actions.register({
			id: "palette.access",
			scope: "app",
			hotkey: "Mod+Shift+P",
			run: async ({ session, dialog }) => {
				if (!session) return;
				await dialog?.({ kind: "custom", id: "palette", title: "Manage Access", data: { mode: "access" }, presentation: "palette" });
			},
		});

		context.actions.register({
			id: "palette.files",
			run: async ({ session, args }) => {
				if (!session) throw new Error("palette.files needs a session");
				const workspace = await session.workspace();
				if (!workspace) throw new Error("this chat has no workspace");
				const query = String((args as { query?: unknown } | undefined)?.query ?? "");
				return { data: await searchFiles(expandHome(workspace.path), query, ignore.get().searchIgnoreDirs ?? DEFAULT_PALETTE_IGNORE_DIRS) };
			},
		});

		context.actions.register({
			id: "palette.openFile",
			run: async ({ session, args }) => {
				if (!session) throw new Error("palette.openFile needs a session");
				const { path, line } = (args ?? {}) as OpenFileArgs;
				if (!path) throw new Error("palette.openFile needs a path");
				const workspace = await session.workspace();
				if (!workspace) throw new Error("this chat has no workspace");
				const opened = await openFileInEditor(join(expandHome(workspace.path), path), line);
				if (!opened.ok) throw new Error(`could not open ${path}: ${opened.reason}`);
			},
		});
	},
};

export default paletteExtension;
