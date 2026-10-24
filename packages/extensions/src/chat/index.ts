import { EVENTS, expandHome, ISelectionService, type Extension } from "@milu/core";

const chatExtension: Extension = {
	id: "chat",
	apiVersion: 1,

	contributions: {
		"composer.commands": [
			{
				id: "compact",
				name: "compact",
				description: "Manually compact the conversation surface",
				kind: "execute",
				action: "chat.compact",
			},
			{
				id: "clear",
				name: "clear",
				description: "Clear the conversation and start a fresh session (previous log is archived)",
				kind: "execute",
				action: "chat.clear",
			},
			{
				id: "workspace",
				name: "workspace",
				description: "Set or clear the working directory for this conversation (no path clears)",
				kind: "leadingInput",
				hint: "[<path>]",
				action: "chat.workspace",
			},
		],
	},

	activate(context) {
		context.actions.register({
			id: "chat.close",
			scope: "chat",
			hotkey: { web: "Option+Shift+W", desktop: "Mod+W" },
			run: async () => {
				await context.get(ISelectionService).select(null);
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
			id: "chat.compact",
			run: async ({ session }) => {
				if (!session) throw new Error("chat.compact needs a session");
				const result = await session.compact();
				if (!result) throw new Error("nothing to compact yet");
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

export default chatExtension;
