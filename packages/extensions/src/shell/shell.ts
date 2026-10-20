import type { Extension } from "@milu/core";

export const shellExtension: Extension = {
	id: "shell",
	apiVersion: 1,

	contributions: {
		"composer.left": [{ id: "shell", order: 10, widget: "shell" }],
	},

	activate(context) {
		context.actions.register({
			id: "shell.toggle",
			scope: ["composer.focus", "composer.empty"],
			hotkey: "Tab",
			run: () => ({ kind: "shell", on: "toggle" }),
		});

		context.actions.register({
			id: "shell.exit",
			scope: "composer.shell",
			hotkey: "Escape",
			run: () => ({ kind: "shell", on: false }),
		});

		context.actions.register({
			id: "shell.run",
			run: () => {
				throw new Error("no shell until the permission guard exists — an ungated shell cannot be taken back");
			},
		});
	},
};
