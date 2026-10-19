import type { Extension } from "@milu/core";

export const shellExtension: Extension = {
	id: "composer.shell",
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

export const tipsExtension: Extension = {
	id: "composer.tips",
	apiVersion: 1,

	contributions: {
		"composer.tips": [
			{ id: "mode", order: 10, keys: ["⇥"], label: "shell mode" },
			{ id: "send", order: 20, keys: ["⏎"], label: "send" },
			{ id: "newline", order: 30, keys: ["⇧", "⏎"], label: "newline" },
			{ id: "shell-run", order: 10, keys: ["⏎"], label: "run", when: "shell" },
			{ id: "shell-exit", order: 20, keys: ["⇥"], label: "exit shell mode", when: "shell" },
		],
	},
};
