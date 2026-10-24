import type { Extension } from "@milu/core";

const tipsExtension: Extension = {
	id: "tips",
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

export default tipsExtension;
