import { SelectionServiceId, type Extension } from "@milu/core";

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
	},
};
