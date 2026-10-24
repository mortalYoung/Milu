import type { Extension } from "@milu/core";

const shellExtension: Extension = {
	id: "shell",
	apiVersion: 1,
	widgets: [{ id: "shell", type: "widget", entry: "./widget/shell.tsx" }],

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
				throw new Error("shell mode has no runner yet");
			},
		});
	},
};

export default shellExtension;
