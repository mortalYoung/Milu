import { EVENTS, expandHome, SelectionServiceId, type Extension } from "@milu/core";

export const chatExtension: Extension = {
	id: "chat",
	apiVersion: 1,

	activate(context) {
		context.actions.register({
			id: "chat.close",
			scope: "chat",
			hotkey: { web: "Option+Shift+W", desktop: "Mod+W" },
			run: async () => {
				await context.get(SelectionServiceId).select(null);
			},
		});

		context.actions.register({
			id: "chat.clear",
			run: async ({ session }) => {
				if (!session) throw new Error("chat.clear needs a session");
				if (session.running) throw new Error("the chat is busy");
				await session.reset();
			},
		});

		context.actions.register({
			id: "chat.workspace",
			run: async ({ session, args }) => {
				if (!session) throw new Error("chat.workspace needs a session");
				const raw = (args as { args?: unknown } | undefined)?.args;
				const path = typeof raw === "string" && raw.trim() !== "" ? expandHome(raw.trim()) : null;
				await session.setWorkspace(path);
				if (path) await session.record(EVENTS.sendMessage, { text: path, via: "command", timestamp: Date.now() });
			},
		});
	},
};
