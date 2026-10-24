import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ISelectionService, type Extension } from "@milu/core";

const createExtension: Extension = {
	id: "create",
	apiVersion: 1,
	widgets: [{ id: "create-session", type: "dialog", entry: "./widget/create.tsx" }],

	contributions: {
		"session.header": [{ id: "create", title: "Create", icon: "square-pen", action: "create.session" }],
		"welcome.items": [{ id: "new-chat", order: 0, title: "new chat", variant: "primary", action: "create.session" }],
	},

	activate(context) {
		context.actions.register({
			id: "create.session",
			scope: "app",
			hotkey: { web: "Option+N", desktop: "Mod+N" },
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
				await context.get(ISelectionService).select(name);
			},
		});
	},
};

export default createExtension;
