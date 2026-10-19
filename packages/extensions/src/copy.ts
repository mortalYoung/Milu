import type { Extension } from "@milu/core";

export const copyExtension: Extension = {
	id: "copy",
	apiVersion: 1,

	contributions: {
		"session.menu": [
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
		],
	},

	activate(context) {
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
	},
};
